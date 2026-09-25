// Autenticazione con account locali (IOperatorRepository) e JWT HS256: funziona anche senza
// Internet o IdP aziendale. Il ruolo viene sempre riletto dal repository a ogni verifica.
import { MIN_PASSWORD_LENGTH } from '@/config/constants';
import { domainError, type DomainError } from '@/domain/errors';
import type { Operator } from '@/domain/entities/operator';
import { occupiesWorkstation } from '@/domain/entities/operator';
import type { Workstation } from '@/domain/entities/workstation';
import {
  isClaimActive,
  sessionOnlyClaimKey,
  type WorkstationClaim,
} from '@/domain/entities/workstation-claim';
import { err, ok, type Result } from '@/domain/result';
import { isoDateTime } from '@/domain/value-objects/iso-date';
import { hashPassword, verifyPassword } from '@/lib/hash-password';
import type {
  IOperatorRepository,
  IReferenceDataRepository,
  IWorkstationClaimRepository,
} from '@/repositories/interfaces';
import type { IClock } from '@/services/interfaces/IClock';
import type { ILogger } from '@/services/interfaces/ILogger';
import type {
  ChangePasswordInput,
  IAuthService,
  IssuedSession,
  LoginInput,
  Session,
} from './IAuthService';
import { signSessionToken, verifySessionToken } from './session-token';

export interface LocalAuthServiceDeps {
  readonly operators: IOperatorRepository;
  readonly referenceData: IReferenceDataRepository;
  /** Accettazioni occupate: una per operatore, liberata al logout o alla scadenza della sessione. */
  readonly claims: IWorkstationClaimRepository;
  readonly clock: IClock;
  readonly logger: ILogger;
  readonly secret: string;
  readonly ttlHours: number;
}

/** Messaggio unico per credenziali errate, utente inesistente o disattivato. */
const INVALID_CREDENTIALS = 'Credenziali non valide.';

/** Istante al secondo: il JWT porta `iat` in secondi, la rivendicazione l'istante in millisecondi. */
function alSecondo(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

let hashFittizioCache: string | null = null;
/**
 * Hash su cui verificare la password quando l'utente NON esiste: così il ramo costa quanto quello
 * dell'utente vero e il tempo di risposta del login non dice quali nomi utente esistono.
 */
function hashFittizio(): string {
  hashFittizioCache ??= hashPassword('nessun-operatore-con-questo-nome');
  return hashFittizioCache;
}

export class LocalAuthService implements IAuthService {
  private readonly logger: ILogger;

  constructor(private readonly deps: LocalAuthServiceDeps) {
    this.logger = deps.logger.child('[Auth]');
  }

  async login(input: LoginInput): Promise<Result<IssuedSession, DomainError>> {
    const username = input.username.trim().toLowerCase();
    const operator = await this.deps.operators.findByUsername(username);
    if (operator === null || !operator.isActive) {
      // Stesso costo di un confronto vero: niente oracolo temporale sui nomi utente.
      verifyPassword(input.password, hashFittizio());
      this.logger.warn('login rifiutato', { username });
      return err(domainError('VALIDATION', INVALID_CREDENTIALS));
    }
    if (!verifyPassword(input.password, operator.passwordHash)) {
      this.logger.warn('login rifiutato', { username });
      return err(domainError('VALIDATION', INVALID_CREDENTIALS));
    }
    // L'amministratore non siede a un banco: entra senza occupare uno sportello, qualunque cosa
    // abbia lasciato selezionato nel form (anche quando sono tutti occupati).
    if (!occupiesWorkstation(operator.role)) {
      const issued = await this.issue(operator, null);
      await this.claim(issued.session);
      this.logger.info('login riuscito', {
        operatorId: operator.id,
        role: operator.role,
        workstation: null,
      });
      return ok(issued);
    }
    const scelta = input.workstationId?.trim() ?? '';
    if (scelta === '') {
      return err(
        domainError('VALIDATION', 'Scegli uno sportello libero: serve per lavorare la coda.'),
      );
    }
    const workstation = await this.deps.referenceData.findWorkstationById(
      scelta as Workstation['id'],
    );
    if (workstation === null) {
      return err(domainError('VALIDATION', "Sportello non valido: selezionarne uno dall'elenco."));
    }
    const occupata = await this.occupiedByOther(workstation, operator.id);
    if (occupata !== null) {
      return err(
        domainError(
          'VALIDATION',
          `${workstation.name} è già in uso da ${occupata.operatorName}: scegli un altro sportello.`,
          { workstationId: workstation.id },
        ),
      );
    }
    const issued = await this.issue(operator, workstation);
    await this.claim(issued.session);
    this.logger.info('login riuscito', {
      operatorId: operator.id,
      role: operator.role,
      workstation: workstation.code,
    });
    return ok(issued);
  }

  /**
   * Emette una sessione per un operatore già verificato dal chiamante (accesso veloce di
   * sviluppo): nessun controllo di password né di accettazione occupata, solo emissione e
   * registrazione del posto. Non fa parte della porta `IAuthService`. Per chi non siede a un banco
   * la postazione si ignora.
   */
  async issueSession(operator: Operator, workstation: Workstation | null): Promise<IssuedSession> {
    const issued = await this.issue(
      operator,
      occupiesWorkstation(operator.role) ? workstation : null,
    );
    await this.claim(issued.session);
    return issued;
  }

  async verify(token: string): Promise<Result<Session, DomainError>> {
    const parsed = await verifySessionToken(token, this.deps.secret, this.deps.clock.now());
    if (!parsed.ok) {
      return parsed;
    }
    // Riverifica lato server: l'operatore potrebbe essere stato disattivato o cambiato di ruolo.
    const operator = await this.deps.operators.findById(parsed.value.operatorId);
    if (operator === null || !operator.isActive) {
      return err(domainError('NOT_FOUND', 'Sessione non più valida: operatore non attivo.'));
    }
    // Sportello e ruolo devono andare d'accordo: l'accettatore ha una postazione, l'amministratore
    // no. Una sessione che non torna — un amministratore entrato quando anche lui occupava uno
    // sportello, un ruolo cambiato mentre era collegato — non vale più, e il posto che teneva
    // occupato si libera subito invece di aspettare la scadenza.
    if (occupiesWorkstation(operator.role) !== (parsed.value.workstationId !== null)) {
      await this.deps.claims.deleteByOperator(operator.id);
      this.logger.info('sessione ritirata: sportello e ruolo non coincidono', {
        operatorId: operator.id,
        role: operator.role,
      });
      return err(domainError('NOT_FOUND', 'Sessione da rinnovare: accedi di nuovo.'));
    }
    // Il posto deve essere ancora suo. Se un amministratore ha scollegato lo sportello (turno
    // finito e logout dimenticato), o se un collega si è seduto lì, la sessione non vale più:
    // altrimenti resterebbero in due sullo stesso banco, che è esattamente ciò che l'occupazione
    // della postazione serve a impedire. Chi non ha sportello ha la sua chiave di sessione.
    const claim = await this.deps.claims.findByWorkstation(
      parsed.value.workstationId ?? sessionOnlyClaimKey(parsed.value.operatorId),
    );
    if (claim === null || claim.operatorId !== parsed.value.operatorId) {
      return err(
        domainError(
          'NOT_FOUND',
          'Sessione non più valida: lo sportello è stato liberato. Accedi di nuovo e scegline uno.',
        ),
      );
    }
    // Una sola sessione valida per operatore: quella dell'ULTIMO login o cambio password, la cui
    // emissione coincide con la rivendicazione del posto. Un token più vecchio — copiato in LAN,
    // rimasto in un browser dopo un cambio password — non passa più, senza bisogno di una lista
    // di revoca.
    if (alSecondo(claim.claimedAt) !== alSecondo(parsed.value.issuedAt)) {
      return err(
        domainError('NOT_FOUND', 'Sessione sostituita da un accesso più recente: accedi di nuovo.'),
      );
    }
    return ok({
      ...parsed.value,
      username: operator.username,
      displayName: operator.displayName,
      role: operator.role,
      deskIds: operator.deskIds,
      // Dal repository, non dal token: un reset fatto mentre l'operatore è collegato deve
      // valere subito, e un token emesso prima del cambio non deve riaprire l'obbligo.
      mustChangePassword: operator.mustChangePassword,
    });
  }

  async changePassword(
    session: Session,
    input: ChangePasswordInput,
  ): Promise<Result<IssuedSession, DomainError>> {
    const operator = await this.deps.operators.findById(session.operatorId);
    if (operator === null || !operator.isActive) {
      return err(domainError('NOT_FOUND', 'Sessione non più valida: operatore non attivo.'));
    }
    if (!verifyPassword(input.currentPassword, operator.passwordHash)) {
      this.logger.warn('cambio password rifiutato: password attuale errata', {
        operatorId: operator.id,
      });
      return err(domainError('VALIDATION', 'La password attuale non è corretta.'));
    }
    const nuova = input.newPassword;
    if (nuova.length < MIN_PASSWORD_LENGTH) {
      return err(
        domainError(
          'VALIDATION',
          `La nuova password deve avere almeno ${MIN_PASSWORD_LENGTH} caratteri.`,
        ),
      );
    }
    if (nuova === input.currentPassword) {
      return err(
        domainError('VALIDATION', 'La nuova password deve essere diversa da quella attuale.'),
      );
    }
    const workstation =
      session.workstationId === null
        ? null
        : await this.deps.referenceData.findWorkstationById(session.workstationId);
    if (session.workstationId !== null && workstation === null) {
      return err(domainError('VALIDATION', 'Sportello della sessione non più valido.'));
    }
    const aggiornato = await this.deps.operators.update({
      ...operator,
      passwordHash: hashPassword(nuova),
      mustChangePassword: false,
    });
    this.logger.info('password cambiata', { operatorId: aggiornato.id });
    const issued = await this.issue(
      aggiornato,
      occupiesWorkstation(aggiornato.role) ? workstation : null,
    );
    // Il nuovo token ha una nuova scadenza: l'occupazione del posto la segue.
    await this.claim(issued.session);
    return ok(issued);
  }

  async switchWorkstation(
    session: Session,
    workstationId: string,
  ): Promise<Result<IssuedSession, DomainError>> {
    const operator = await this.deps.operators.findById(session.operatorId);
    if (operator === null || !operator.isActive) {
      return err(domainError('NOT_FOUND', 'Sessione non più valida: operatore non attivo.'));
    }
    if (!occupiesWorkstation(operator.role)) {
      return err(domainError('VALIDATION', "L'amministratore non occupa sportelli."));
    }
    const workstation = await this.deps.referenceData.findWorkstationById(
      workstationId as Workstation['id'],
    );
    if (workstation === null) {
      return err(domainError('VALIDATION', 'Sportello non valido.'));
    }
    const occupata = await this.occupiedByOther(workstation, operator.id);
    if (occupata !== null) {
      return err(
        domainError('VALIDATION', `${workstation.name} è già in uso da ${occupata.operatorName}.`, {
          workstationId: workstation.id,
        }),
      );
    }
    const issued = await this.issue(operator, workstation);
    await this.claim(issued.session);
    return ok(issued);
  }

  async logout(session: Session): Promise<void> {
    // Si libera il posto dell'OPERATORE, non quello scritto nel cookie. Se durante il turno ha
    // cambiato postazione, il token nomina ancora la vecchia: liberare quella lasciava occupata la
    // nuova — il posto «fantasma» che l'amministratore trovava a fine giornata. Un operatore ha al
    // più una rivendicazione (il login la sposta), quindi liberare per operatore è esatto. E la
    // sessione arriva già verificata, quindi non è un cookie vecchio che butta fuori un collega.
    await this.deps.claims.deleteByOperator(session.operatorId);
  }

  /** Occupazione valida di un ALTRO operatore sulla postazione, altrimenti null. */
  private async occupiedByOther(
    workstation: Workstation,
    operatorId: Operator['id'],
  ): Promise<WorkstationClaim | null> {
    const claim = await this.deps.claims.findByWorkstation(workstation.id);
    if (
      claim === null ||
      claim.operatorId === operatorId ||
      !isClaimActive(claim, this.deps.clock.nowIso())
    ) {
      return null;
    }
    return claim;
  }

  /**
   * Registra il posto della sessione; l'operatore lascia quello che occupava prima. Chi non ha
   * sportello registra la sola sessione, con la sua chiave: non occupa niente.
   */
  private async claim(session: Session): Promise<void> {
    await this.deps.claims.deleteByOperator(session.operatorId);
    await this.deps.claims.upsert({
      workstationId: session.workstationId ?? sessionOnlyClaimKey(session.operatorId),
      operatorId: session.operatorId,
      operatorName: session.displayName,
      claimedAt: session.issuedAt,
      expiresAt: session.expiresAt,
    });
  }

  private async issue(operator: Operator, workstation: Workstation | null): Promise<IssuedSession> {
    const now = this.deps.clock.now();
    const expires = new Date(now.getTime() + this.deps.ttlHours * 3_600_000);
    const session: Session = {
      operatorId: operator.id,
      username: operator.username,
      displayName: operator.displayName,
      role: operator.role,
      workstationId: workstation?.id ?? null,
      deskIds: operator.deskIds,
      mustChangePassword: operator.mustChangePassword,
      issuedAt: isoDateTime(now),
      expiresAt: isoDateTime(expires),
    };
    const token = await signSessionToken(session, this.deps.secret);
    return { session, token };
  }
}
