// Outbox verso CRM/BDC (modulo F): no-show e anomalie di flusso da consegnare
// in modo asincrono con retry; MANUAL quando il supervisor segna "inviato al BDC".

import type { AppointmentId, CrmOutboxEventId, OperatorId } from '../ids';
import type { IsoDateTime } from '../value-objects/iso-date';

/** Tipo di evento verso il CRM. */
/**
 * Eventi che il CRM/BDC riceve dall'officina.
 * `CHECK_IN` è l'accettazione conclusa al veicolo: note e foto raccolte al tablet finiscono nel
 * fascicolo del cliente, così chi lo richiama sa cosa è stato rilevato sulla vettura.
 */
export type CrmEventType = 'NO_SHOW' | 'ANOMALY' | 'CHECK_IN';

/** Anomalie di flusso segnalate al BDC. */
export type CrmAnomalyKind =
  'EXCESSIVE_SKIPS' | 'LONG_WAIT' | 'NOTIFICATION_FAILED' | 'MANUAL_APPOINTMENT';

/**
 * Stato di consegna dell'evento.
 * `MANUAL` significa "gestito a mano": il BDC ha ricontattato il cliente (o ha inserito l'evento
 * nel proprio gestionale) e la riga non va più lavorata, comunque sia andata la consegna al CRM.
 */
export type CrmOutboxStatus = 'PENDING' | 'SENT' | 'FAILED' | 'MANUAL';

/** Evento in outbox verso il CRM. */
export interface CrmOutboxEvent {
  readonly id: CrmOutboxEventId;
  readonly type: CrmEventType;
  readonly anomalyKind: CrmAnomalyKind | null;
  readonly appointmentId: AppointmentId;
  readonly idempotencyKey: string;
  /**
   * Payload esatto consegnato al CRM: è quello che verrà rispedito a ogni tentativo, senza
   * ricostruirlo dalla pratica (che nel frattempo può essere cambiata). È il patto della coda di
   * uscita: si invia quello che è stato deciso al momento del fatto.
   */
  readonly payload: Readonly<Record<string, unknown>>;
  /** Parole dell'operatore (es. il motivo scritto segnando un assente); non fanno parte del DTO. */
  readonly operatorNote: string | null;
  readonly status: CrmOutboxStatus;
  readonly attemptCount: number;
  readonly nextAttemptAt: IsoDateTime | null;
  readonly lastError: string | null;
  readonly crmAckId: string | null;
  readonly createdAt: IsoDateTime;
  readonly sentAt: IsoDateTime | null;
  /** Quando un operatore del BDC ha dichiarato di aver ricontattato il cliente. */
  readonly handledAt: IsoDateTime | null;
  readonly handledByOperatorId: OperatorId | null;
  /** Nota lasciata dal BDC al momento del ricontatto (esito della telefonata). */
  readonly handledNote: string | null;
}
