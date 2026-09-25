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
  /**
   * Postazione scelta al login: determina sportello e campata proposti. null per chi non siede a
   * un banco (amministratore, kiosk: `occupiesWorkstation`), che entra senza occupare sportelli.
   */
  readonly workstationId: WorkstationId | null;
  /** Sportelli abituali dell'operatore. */
  readonly deskIds: readonly DeskId[];
  /** True finché l'operatore non sostituisce la password provvisoria: può fare solo quello. */
  readonly mustChangePassword: boolean;
  readonly issuedAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
}

/** Cambio password da parte dell'operatore stesso (mai dall'amministratore). */
export interface ChangePasswordInput {
  readonly currentPassword: string;
  readonly newPassword: string;
}

/** Credenziali e postazione inviate dal form di login. */
export interface LoginInput {
  readonly username: string;
  readonly password: string;
  /**
   * Postazione scelta; null o vuota = nessuna. Obbligatoria per l'accettatore, ignorata per
   * l'amministratore (che non occupa sportelli, qualunque cosa scelga).
   */
  readonly workstationId: string | null;
}

/** Sessione emessa insieme al token firmato da mettere nel cookie. */
export interface IssuedSession {
  readonly session: Session;
  readonly token: string;
}

export interface IAuthService {
  /**
   * Verifica credenziali e accettazione; l'errore sulle credenziali è sempre generico (nessuna
   * enumerazione utenti). Un'accettazione già in uso da un altro operatore viene rifiutata.
   */
  login(input: LoginInput): Promise<Result<IssuedSession, DomainError>>;
  /** Libera l'accettazione occupata dalla sessione (il cookie lo cancella il Route Handler). */
  logout(session: Session): Promise<void>;
  /** Verifica firma e scadenza del token e RIVERIFICA l'operatore nel repository (ruolo, attivo). */
  verify(token: string): Promise<Result<Session, DomainError>>;
  /** Cambia postazione senza nuovo login: emette un nuovo token. */
  switchWorkstation(
    session: Session,
    workstationId: string,
  ): Promise<Result<IssuedSession, DomainError>>;
  /**
   * Sostituisce la password verificando quella attuale ed emette un nuovo token senza l'obbligo
   * di cambio. Un adapter SSO risponde NOT_IMPLEMENTED: la password la gestisce l'IdP.
   */
  changePassword(
    session: Session,
    input: ChangePasswordInput,
  ): Promise<Result<IssuedSession, DomainError>>;
}
