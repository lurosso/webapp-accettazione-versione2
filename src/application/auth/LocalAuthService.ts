// Autenticazione con account locali (IOperatorRepository) e JWT HS256: funziona anche senza
// Internet o IdP aziendale. Il ruolo viene sempre riletto dal repository a ogni verifica.
import { domainError, type DomainError } from '@/domain/errors';
import type { Operator } from '@/domain/entities/operator';
import type { Workstation } from '@/domain/entities/workstation';
import { err, ok, type Result } from '@/domain/result';
import { isoDateTime } from '@/domain/value-objects/iso-date';
import { verifyPassword } from '@/lib/hash-password';
import type { IOperatorRepository, IReferenceDataRepository } from '@/repositories/interfaces';
import type { IClock } from '@/services/interfaces/IClock';
import type { ILogger } from '@/services/interfaces/ILogger';
import type { IAuthService, IssuedSession, LoginInput, Session } from './IAuthService';
import { signSessionToken, verifySessionToken } from './session-token';

export interface LocalAuthServiceDeps {
  readonly operators: IOperatorRepository;
  readonly referenceData: IReferenceDataRepository;
  readonly clock: IClock;
  readonly logger: ILogger;
  readonly secret: string;
  readonly ttlHours: number;
}

/** Messaggio unico per credenziali errate, utente inesistente o disattivato. */
const INVALID_CREDENTIALS = 'Credenziali non valide.';

export class LocalAuthService implements IAuthService {
  private readonly logger: ILogger;

  constructor(private readonly deps: LocalAuthServiceDeps) {
    this.logger = deps.logger.child('[Auth]');
  }

  async login(input: LoginInput): Promise<Result<IssuedSession, DomainError>> {
    const username = input.username.trim().toLowerCase();
    const operator = await this.deps.operators.findByUsername(username);
    if (
      operator === null ||
      !operator.isActive ||
      !verifyPassword(input.password, operator.passwordHash)
    ) {
      this.logger.warn('login rifiutato', { username });
      return err(domainError('VALIDATION', INVALID_CREDENTIALS));
    }
    const workstation = await this.deps.referenceData.findWorkstationById(
      input.workstationId as Workstation['id'],
    );
    if (workstation === null) {
      return err(domainError('VALIDATION', "Postazione non valida: selezionarne una dall'elenco."));
    }
    const issued = await this.issue(operator, workstation);
    this.logger.info('login riuscito', {
      operatorId: operator.id,
      role: operator.role,
      workstation: workstation.code,
    });
    return ok(issued);
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
    return ok({
      ...parsed.value,
      username: operator.username,
      displayName: operator.displayName,
      role: operator.role,
      deskIds: operator.deskIds,
    });
  }

  async switchWorkstation(
    session: Session,
    workstationId: string,
  ): Promise<Result<IssuedSession, DomainError>> {
    const operator = await this.deps.operators.findById(session.operatorId);
    if (operator === null || !operator.isActive) {
      return err(domainError('NOT_FOUND', 'Sessione non più valida: operatore non attivo.'));
    }
    const workstation = await this.deps.referenceData.findWorkstationById(
      workstationId as Workstation['id'],
    );
    if (workstation === null) {
      return err(domainError('VALIDATION', 'Postazione non valida.'));
    }
    return ok(await this.issue(operator, workstation));
  }

  private async issue(operator: Operator, workstation: Workstation): Promise<IssuedSession> {
    const now = this.deps.clock.now();
    const expires = new Date(now.getTime() + this.deps.ttlHours * 3_600_000);
    const session: Session = {
      operatorId: operator.id,
      username: operator.username,
      displayName: operator.displayName,
      role: operator.role,
      workstationId: workstation.id,
      deskIds: operator.deskIds,
      issuedAt: isoDateTime(now),
      expiresAt: isoDateTime(expires),
    };
    const token = await signSessionToken(session, this.deps.secret);
    return { session, token };
  }
}
