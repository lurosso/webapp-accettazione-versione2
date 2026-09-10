// Pratica (Appointment): aggregate root della giornata operativa, con snapshot
// embedded di cliente e veicolo (Infinity è master, la pratica resta stabile per il giorno).

import type { AppointmentId, BayId, BrandId, DeskId, OperatorId, SyncRunId } from '../ids';
import type { IsoDate, IsoDateTime } from '../value-objects/iso-date';
import type { QueueCode } from '../value-objects/queue-code';
import type { Customer } from './customer';
import type { Vehicle } from './vehicle';

/**
 * Stati della pratica: i quattro dei requisiti (In Attesa, In Carico, Salta, Completato)
 * più NO_SHOW (trigger modulo F) e CANCELLED (reconciliation non distruttiva, ADR-006).
 */
export const APPOINTMENT_STATUSES = [
  'WAITING',
  'IN_PROGRESS',
  'SKIPPED',
  'COMPLETED',
  'NO_SHOW',
  'CANCELLED',
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Origine della pratica: agenda Infinity o inserimento manuale (fallback). */
export type AppointmentSource = 'INFINITY' | 'MANUAL';

/** Pratica. Immutabile: ogni modifica crea un nuovo oggetto con `version + 1`. */
export interface Appointment {
  readonly id: AppointmentId;
  /** Id dell'appuntamento in Infinity; null se `source === 'MANUAL'`. */
  readonly externalRef: string | null;
  readonly source: AppointmentSource;
  /** Giornata operativa (Europe/Rome). */
  readonly businessDate: IsoDate;
  /** Orario di prenotazione (UTC): chiave di ordinamento della coda. */
  readonly scheduledAt: IsoDateTime;
  /** Codice progressivo comunicato al cliente (F001). Mai rinumerato né riutilizzato. */
  readonly code: QueueCode;
  /** Sequenza numerica del codice (1 per F001). */
  readonly sequence: number;
  readonly brandId: BrandId;
  readonly deskId: DeskId | null;
  readonly customer: Customer;
  readonly vehicle: Vehicle;
  readonly serviceDescription: string | null;
  readonly status: AppointmentStatus;
  /** Campata occupata mentre la pratica è IN_PROGRESS. */
  readonly bayId: BayId | null;
  /** Operatore che ha preso in carico la pratica. */
  readonly operatorId: OperatorId | null;
  /** Numero di volte in cui la pratica è stata saltata. */
  readonly skipCount: number;
  readonly notes: string | null;
  readonly takenAt: IsoDateTime | null;
  readonly skippedAt: IsoDateTime | null;
  readonly completedAt: IsoDateTime | null;
  readonly noShowAt: IsoDateTime | null;
  readonly cancelledAt: IsoDateTime | null;
  /** Ultima sincronizzazione che ha toccato la pratica. */
  readonly lastSyncRunId: SyncRunId | null;
  /** Versione per la concorrenza ottimistica fra postazioni (409 → ConflictDialog). */
  readonly version: number;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

/** Stati che contano come "in coda" (WAITING e SKIPPED). */
export const ACTIVE_QUEUE_STATUSES: readonly AppointmentStatus[] = ['WAITING', 'SKIPPED'];

/** Stati terminali: nessuna transizione in uscita (COMPLETED, CANCELLED). */
export const TERMINAL_STATUSES: readonly AppointmentStatus[] = ['COMPLETED', 'CANCELLED'];

/** Indica se lo stato è terminale. */
export function isTerminalStatus(s: AppointmentStatus): boolean {
  return TERMINAL_STATUSES.includes(s);
}

/** Indica se la pratica è ancora in coda (WAITING o SKIPPED). */
export function isInQueue(s: AppointmentStatus): boolean {
  return ACTIVE_QUEUE_STATUSES.includes(s);
}
