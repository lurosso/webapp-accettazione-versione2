// Sportello fisico dell'accettazione (A, B, C, D) con il monitor dedicato sopra il banco.
// È SOLO configurazione: nessun `currentAppointmentId`. L'occupazione è derivata
// dall'unica pratica IN_PROGRESS con quel `bayId` (Appointment.bayId + status),
// così esiste una sola fonte di verità (ADR-008).

import type { BayId } from '../ids';

/** Ordinale interno dello sportello (1..4): ordina le liste, non si mostra al cliente. */
export type BayNumber = 1 | 2 | 3 | 4;

/** Sportello fisico: dato di configurazione. */
export interface Bay {
  readonly id: BayId;
  /** Lettera dello sportello, usata a video e nell'URL del monitor: "A". */
  readonly code: string;
  readonly number: BayNumber;
  readonly name: string;
  /** Token segreto con cui il display kiosk si autentica (?token=). */
  readonly displayToken: string;
  readonly isActive: boolean;
}
