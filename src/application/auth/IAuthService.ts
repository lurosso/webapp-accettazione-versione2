// Porta interna dell'autenticazione operatore. Oggi implementata da LocalAuthService (account
// locali + JWT); domani da un adapter SSO (Entra ID) senza toccare pagine e Route Handler.
import type { OperatorRole } from '@/domain/entities/operator';
import type { DomainError } from '@/domain/errors';
import type { DeskId, OperatorId, WorkstationId } from '@/domain/ids';
import type { Result } from '@/domain/result';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';

/** Sessione autenticata: ciò che pagine e API sanno dell'operatore collegato. */
export interface Session {
  readonly operatorId: OperatorId;
  readonly username: string;
  readonly displayName: string;
  readonly role: OperatorRole;
  /** Postazione scelta al login: determina sportello e campata proposti. */
  readonly workstationId: WorkstationId;
  /** Sportelli abituali dell'operatore. */
  readonly deskIds: readonly DeskId[];
  readonly issuedAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
}

/** Credenziali e postazione inviate dal form di login. */
export interface LoginInput {
  readonly username: string;
  readonly password: string;
  readonly workstationId: string;
}

/** Sessione emessa insieme al token firmato da mettere nel cookie. */
export interface IssuedSession {
  readonly session: Session;
  readonly token: string;
}

export interface IAuthService {
  /** Verifica credenziali e postazione; l'errore è sempre generico (nessuna enumerazione utenti). */
  login(input: LoginInput): Promise<Result<IssuedSession, DomainError>>;
  /** Verifica firma e scadenza del token e RIVERIFICA l'operatore nel repository (ruolo, attivo). */
  verify(token: string): Promise<Result<Session, DomainError>>;
  /** Cambia postazione senza nuovo login: emette un nuovo token. */
  switchWorkstation(
    session: Session,
    workstationId: string,
  ): Promise<Result<IssuedSession, DomainError>>;
}
