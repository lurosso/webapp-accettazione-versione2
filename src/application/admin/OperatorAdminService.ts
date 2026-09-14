// Gestione degli operatori dal pannello di amministrazione.
//
// Poche regole, ma ferme, perché qui un errore chiude fuori qualcuno dal sistema:
// - un amministratore non può disattivare sé stesso né togliersi il ruolo: lo farebbe un altro
//   amministratore, altrimenti l'ultimo che esce spegne la luce a tutti;
// - non si può disattivare o degradare l'ultimo amministratore attivo, per la stessa ragione;
// - il nome utente è unico (confronto senza maiuscole) e non si cambia: è la chiave con cui gli
//   operatori si riconoscono nei log e nel registro degli eventi;
// - la password si azzera generandone una provvisoria che si mostra UNA volta sola. Nessuno,
//   neppure l'amministratore, deve poter scegliere la password di un collega.
import type { Operator, OperatorRole } from '@/domain/entities/operator';
import { domainError, type DomainError } from '@/domain/errors';
import { asDeskId, asOperatorId, asWorkstationId, type OperatorId } from '@/domain/ids';
import { err, ok, type Result } from '@/domain/result';
import { MIN_PASSWORD_LENGTH } from '@/config/constants';
import { generateTemporaryPassword, hashPassword } from '@/lib/hash-password';
import type { IOperatorRepository, IReferenceDataRepository } from '@/repositories/interfaces';
import type { IIdGenerator } from '@/services/interfaces/IIdGenerator';
import type { ILogger } from '@/services/interfaces/ILogger';

export interface OperatorAdminServiceDeps {
  readonly operators: IOperatorRepository;
  readonly referenceData: IReferenceDataRepository;
  readonly ids: IIdGenerator;
  readonly logger: ILogger;
}

/** Operatore come lo vede il pannello: mai l'hash della password. */
export interface OperatorView {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly role: OperatorRole;
  readonly deskIds: readonly string[];
  readonly deskCodes: readonly string[];
  readonly defaultWorkstationId: string | null;
  readonly isActive: boolean;
  /** True finché l'operatore non ha sostituito la password iniziale o provvisoria. */
  readonly mustChangePassword: boolean;
}

export interface CreateOperatorInput {
  readonly username: string;
  readonly displayName: string;
  readonly role: OperatorRole;
  readonly deskIds: readonly string[];
  readonly defaultWorkstationId: string | null;
  readonly password: string;
}

export interface UpdateOperatorInput {
  readonly displayName?: string | undefined;
  readonly role?: OperatorRole | undefined;
  readonly deskIds?: readonly string[] | undefined;
  readonly defaultWorkstationId?: string | null | undefined;
  readonly isActive?: boolean | undefined;
}

export interface ResetPasswordResult {
  readonly operator: OperatorView;
  /** Mostrata una volta sola: da qui in avanti esiste solo il suo hash. */
  readonly temporaryPassword: string;
}

/** Chi sta agendo: serve per i divieti su sé stessi. */
export interface AdminActor {
  readonly operatorId: OperatorId;
}

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;

export class OperatorAdminService {
  private readonly logger: ILogger;

  constructor(private readonly deps: OperatorAdminServiceDeps) {
    this.logger = deps.logger.child('[Admin]');
  }

  /** Tutti gli operatori, attivi e non, con i codici degli sportelli già risolti. */
  async list(): Promise<readonly OperatorView[]> {
    const [operatori, desks] = await Promise.all([
      this.deps.operators.listAll(),
      this.deps.referenceData.listDesks(),
    ]);
    return [...operatori]
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'it'))
      .map((o) => toView(o, desks));
  }

  async create(
    input: CreateOperatorInput,
    actor: AdminActor,
  ): Promise<Result<OperatorView, DomainError>> {
    const username = input.username.trim().toLowerCase();
    if (!USERNAME_PATTERN.test(username)) {
      return err(
        domainError(
          'VALIDATION',
          'Nome utente non valido: da 3 a 64 caratteri, lettere minuscole, numeri, punto, trattino.',
        ),
      );
    }
    if (input.password.length < MIN_PASSWORD_LENGTH) {
      return err(
        domainError(
          'VALIDATION',
          `La password deve avere almeno ${MIN_PASSWORD_LENGTH} caratteri.`,
        ),
      );
    }
    const displayName = input.displayName.trim();
    if (displayName.length === 0) {
      return err(domainError('VALIDATION', 'Il nome da mostrare è obbligatorio.'));
    }
    if ((await this.deps.operators.findByUsername(username)) !== null) {
      return err(domainError('VALIDATION', `Nome utente già in uso: ${username}.`));
    }
    const riferimenti = await this.validateReferences(input.deskIds, input.defaultWorkstationId);
    if (!riferimenti.ok) {
      return riferimenti;
    }

    const operator: Operator = {
      id: asOperatorId(this.deps.ids.next()),
      username,
      displayName,
      role: input.role,
      deskIds: input.deskIds.map(asDeskId),
      defaultWorkstationId:
        input.defaultWorkstationId === null ? null : asWorkstationId(input.defaultWorkstationId),
      passwordHash: hashPassword(input.password),
      isActive: true,
      // La password iniziale la conosce anche l'amministratore: va cambiata al primo accesso.
      mustChangePassword: true,
    };
    const salvato = await this.deps.operators.insert(operator);
    this.logger.info(`operatore creato: ${username}`, { role: input.role, da: actor.operatorId });
    return ok(toView(salvato, await this.deps.referenceData.listDesks()));
  }

  async update(
    id: OperatorId,
    input: UpdateOperatorInput,
    actor: AdminActor,
  ): Promise<Result<OperatorView, DomainError>> {
    const corrente = await this.deps.operators.findById(id);
    if (corrente === null) {
      return err(domainError('NOT_FOUND', `Operatore non trovato: ${id}.`));
    }

    const disattiva = input.isActive === false && corrente.isActive;
    const degrada = input.role !== undefined && input.role !== 'ADMIN' && corrente.role === 'ADMIN';
    if (id === actor.operatorId && (disattiva || degrada)) {
      return err(
        domainError(
          'VALIDATION',
          'Non puoi disattivare o cambiare il ruolo al tuo stesso account: deve farlo un altro amministratore.',
        ),
      );
    }
    if ((disattiva || degrada) && corrente.role === 'ADMIN') {
      const attivi = (await this.deps.operators.listAll()).filter(
        (o) => o.isActive && o.role === 'ADMIN' && o.id !== id,
      );
      if (attivi.length === 0) {
        return err(
          domainError(
            'VALIDATION',
            "Questo è l'ultimo amministratore attivo: non può essere disattivato o degradato.",
          ),
        );
      }
    }
    if (input.displayName !== undefined && input.displayName.trim().length === 0) {
      return err(domainError('VALIDATION', 'Il nome da mostrare è obbligatorio.'));
    }
    const riferimenti = await this.validateReferences(
      input.deskIds ?? corrente.deskIds,
      input.defaultWorkstationId === undefined
        ? corrente.defaultWorkstationId
        : input.defaultWorkstationId,
    );
    if (!riferimenti.ok) {
      return riferimenti;
    }

    const aggiornato = await this.deps.operators.update({
      ...corrente,
      displayName: input.displayName?.trim() ?? corrente.displayName,
      role: input.role ?? corrente.role,
      deskIds: input.deskIds === undefined ? corrente.deskIds : input.deskIds.map(asDeskId),
      defaultWorkstationId:
        input.defaultWorkstationId === undefined
          ? corrente.defaultWorkstationId
          : input.defaultWorkstationId === null
            ? null
            : asWorkstationId(input.defaultWorkstationId),
      isActive: input.isActive ?? corrente.isActive,
    });
    this.logger.info(`operatore aggiornato: ${aggiornato.username}`, {
      campi: Object.keys(input),
      da: actor.operatorId,
    });
    return ok(toView(aggiornato, await this.deps.referenceData.listDesks()));
  }

  /**
   * Password provvisoria: leggibile a voce e senza caratteri ambigui (niente 0/O, 1/l/I), perché
   * verrà dettata al collega davanti alla postazione. Da cambiare al primo accesso: finché non lo
   * fa, l'operatore non può aprire nient'altro.
   */
  async resetPassword(
    id: OperatorId,
    actor: AdminActor,
  ): Promise<Result<ResetPasswordResult, DomainError>> {
    const corrente = await this.deps.operators.findById(id);
    if (corrente === null) {
      return err(domainError('NOT_FOUND', `Operatore non trovato: ${id}.`));
    }
    const temporaryPassword = generateTemporaryPassword();
    const aggiornato = await this.deps.operators.update({
      ...corrente,
      passwordHash: hashPassword(temporaryPassword),
      mustChangePassword: true,
    });
    this.logger.warn(`password azzerata per ${aggiornato.username}`, { da: actor.operatorId });
    return ok({
      operator: toView(aggiornato, await this.deps.referenceData.listDesks()),
      temporaryPassword,
    });
  }

  private async validateReferences(
    deskIds: readonly string[],
    workstationId: string | null,
  ): Promise<Result<void, DomainError>> {
    const desks = await this.deps.referenceData.listDesks();
    const sconosciuti = deskIds.filter((id) => !desks.some((d) => d.id === id));
    if (sconosciuti.length > 0) {
      return err(domainError('VALIDATION', 'Sportello sconosciuto.', { deskIds: sconosciuti }));
    }
    if (workstationId !== null) {
      const ws = await this.deps.referenceData.findWorkstationById(asWorkstationId(workstationId));
      if (ws === null) {
        return err(domainError('VALIDATION', 'Accettazione sconosciuta.', { workstationId }));
      }
    }
    return ok(undefined);
  }
}

function toView(o: Operator, desks: readonly { id: string; code: string }[]): OperatorView {
  return {
    id: o.id,
    username: o.username,
    displayName: o.displayName,
    role: o.role,
    deskIds: [...o.deskIds],
    deskCodes: o.deskIds.map((id) => desks.find((d) => d.id === id)?.code ?? id),
    defaultWorkstationId: o.defaultWorkstationId,
    isActive: o.isActive,
    mustChangePassword: o.mustChangePassword,
  };
}
