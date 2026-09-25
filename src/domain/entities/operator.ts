// Accettatore (operatore) con ruolo e sportelli di competenza.

import type { DeskId, OperatorId, WorkstationId } from '../ids';

/**
 * Ruoli: ADVISOR (accettatore) opera sulla coda; ADMIN gestisce operatori, assistenza, chiusura
 * della giornata e pagina Sistema, e può tutto ciò che può l'accettatore; KIOSK è l'account di un
 * dispositivo (monitor, tabellone): entra e viene portato agli schermi pubblici, non ha accesso a
 * nessuna area operatore. A schermo si leggono Accettatore, Amministratore, Kiosk.
 * Il ruolo SUPERVISOR (responsabile/BDC) è stato tolto il 2026-09-24: il BDC lavora nel proprio CRM.
 */
export type OperatorRole = 'ADVISOR' | 'ADMIN' | 'KIOSK';

/** Elenco unico dei ruoli: lo usano il JWT di sessione e gli schemi delle API. */
export const OPERATOR_ROLES: readonly OperatorRole[] = ['ADVISOR', 'ADMIN', 'KIOSK'];

export function isOperatorRole(value: unknown): value is OperatorRole {
  return typeof value === 'string' && (OPERATOR_ROLES as readonly string[]).includes(value);
}

/**
 * Solo l'accettatore siede a uno sportello: al login ne sceglie uno e da quel momento è suo.
 * L'amministratore (e un dispositivo kiosk) entra senza occupare niente, così non toglie un banco
 * a chi deve lavorare la coda.
 */
export function occupiesWorkstation(role: OperatorRole): boolean {
  return role === 'ADVISOR';
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
  /**
   * Matricola dell'accettatore in Infinity (`o_operai.matricola`), impostata dall'amministratore:
   * le prenotazioni assegnate a quella matricola sono «Le mie prenotazioni». null = non collegato.
   */
  readonly infinityAdvisorCode: string | null;
}
