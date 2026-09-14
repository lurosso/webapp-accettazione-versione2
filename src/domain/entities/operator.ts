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
}
