// Campata d'accettazione (C1..C4) con display dedicato.
// È SOLO configurazione: nessun `currentAppointmentId`. L'occupazione è derivata
// dall'unica pratica IN_PROGRESS con quel `bayId` (Appointment.bayId + status),
// così esiste una sola fonte di verità (ADR-008).

import type { BayId } from '../ids';

/** Numero di campata fisica. */
export type BayNumber = 1 | 2 | 3 | 4;

/** Campata: dato di configurazione. */
export interface Bay {
  readonly id: BayId;
  /** Codice usato nell'URL del display, es. "C1". */
  readonly code: string;
  readonly number: BayNumber;
  readonly name: string;
  /** Token segreto con cui il display kiosk si autentica (?token=). */
  readonly displayToken: string;
  readonly isActive: boolean;
}
