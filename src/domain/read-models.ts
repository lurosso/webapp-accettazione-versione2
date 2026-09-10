// Read model: le uniche forme restituite dalle API pubbliche (/api/v1/public/*).
// Nessun nome, telefono o modello: solo codice, stato e posizione.

import type { Appointment, AppointmentStatus } from './entities/appointment';
import type { NotificationJobStatus } from './entities/notification';
import type { IsoDateTime } from './value-objects/iso-date';
import type { QueueCode } from './value-objects/queue-code';

/** Posizione in coda mostrata dal portale cliente dopo la ricerca per targa. */
export interface QueuePositionView {
  readonly code: QueueCode;
  readonly status: AppointmentStatus;
  /** Clienti in attesa prima del cliente (regola QUEUE_AHEAD_SCOPE). */
  readonly aheadCount: number;
  /** Campata in servizio quando la pratica è IN_PROGRESS. */
  readonly bayNumber: number | null;
  readonly brandCode: string;
  readonly updatedAt: IsoDateTime;
}

/** Stato del display di campata. OFFLINE è deciso dal client dopo 3 poll falliti. */
export type BayDisplayState = 'SERVING' | 'RELEASING' | 'FREE' | 'OFFLINE';

/** Read model del display di campata, calcolato dalle pratiche (nessuno stato persistito sulla Bay). */
export interface BayDisplayView {
  readonly bayCode: string;
  readonly bayNumber: number;
  readonly state: BayDisplayState;
  readonly currentCode: QueueCode | null;
  readonly since: IsoDateTime | null;
  readonly lastCompletedCode: QueueCode | null;
  readonly lastCompletedAt: IsoDateTime | null;
}

/** Riga della tabella coda per la dashboard operatore (area autenticata). */
export interface QueueRowView {
  readonly appointment: Appointment;
  readonly operatorName: string | null;
  readonly bayCode: string | null;
  readonly notificationStatus: NotificationJobStatus | null;
}
