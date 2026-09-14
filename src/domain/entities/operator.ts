// Accettatore (operatore) con ruolo e sportelli di competenza.

import type { DeskId, OperatorId, WorkstationId } from '../ids';

/**
 * Ruoli: ADVISOR (accettatore) opera sulla coda; SUPERVISOR (manager) forza stati, riapre no-show,
 * conferma i fallback manuali e lavora il cruscotto BDC; ADMIN gestisce operatori, assistenza e
 * pagina Sistema; KIOSK è l'account di un dispositivo (monitor, tabellone): entra e viene portato
 * agli schermi pubblici, non ha accesso a nessuna area operatore.
 * I codici restano quelli dell'analisi; a schermo si leggono Accettatore, Manager, Amministratore, Kiosk.
 */
export type OperatorRole = 'ADVISOR' | 'SUPERVISOR' | 'ADMIN' | 'KIOSK';

/** Elenco unico dei ruoli: lo usano il JWT di sessione e gli schemi delle API. */
export const OPERATOR_ROLES: readonly OperatorRole[] = ['ADVISOR', 'SUPERVISOR', 'ADMIN', 'KIOSK'];

export function isOperatorRole(value: unknown): value is OperatorRole {
  return typeof value === 'string' && (OPERATOR_ROLES as readonly string[]).includes(value);
}

/** Accettatore. Il ruolo è sempre riverificato lato server, mai fidandosi del solo JWT. */
export interface Operator {
  readonly id: OperatorId;
  readonly username: string;
  readonly displayName: string;
  readonly role: OperatorRole;
  /** Sportelli su cui l'operatore lavora abitualmente. */
  readonly deskIds: readonly DeskId[];
  readonly defaultWorkstationId: WorkstationId | null;
  /** Hash della password (scrypt da M1). Nel seed demo vale "plain:demo": SOLO sviluppo. */
  readonly passwordHash: string;
  readonly isActive: boolean;
  /**
   * True dopo la creazione dell'account e dopo un reset da parte dell'amministratore: la password
   * la conosce anche chi l'ha dettata, quindi finché non viene cambiata l'operatore può fare solo
   * quello. Torna false al primo cambio riuscito.
   */
  readonly mustChangePassword: boolean;
}
