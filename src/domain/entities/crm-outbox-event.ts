// Outbox verso CRM/BDC (modulo F): no-show e anomalie di flusso da consegnare
// in modo asincrono con retry; MANUAL quando il supervisor segna "inviato al BDC".

import type { AppointmentId, CrmOutboxEventId } from '../ids';
import type { IsoDateTime } from '../value-objects/iso-date';

/** Tipo di evento verso il CRM. */
export type CrmEventType = 'NO_SHOW' | 'ANOMALY';

/** Anomalie di flusso segnalate al BDC. */
export type CrmAnomalyKind =
  'EXCESSIVE_SKIPS' | 'LONG_WAIT' | 'NOTIFICATION_FAILED' | 'MANUAL_APPOINTMENT';

/** Stato di consegna dell'evento. */
export type CrmOutboxStatus = 'PENDING' | 'SENT' | 'FAILED' | 'MANUAL';

/** Evento in outbox verso il CRM. */
export interface CrmOutboxEvent {
  readonly id: CrmOutboxEventId;
  readonly type: CrmEventType;
  readonly anomalyKind: CrmAnomalyKind | null;
  readonly appointmentId: AppointmentId;
  readonly idempotencyKey: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly status: CrmOutboxStatus;
  readonly attemptCount: number;
  readonly nextAttemptAt: IsoDateTime | null;
  readonly lastError: string | null;
  readonly crmAckId: string | null;
  readonly createdAt: IsoDateTime;
  readonly sentAt: IsoDateTime | null;
}
