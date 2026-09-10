// Outbox delle notifiche: un NotificationJob per messaggio logico, un
// NotificationAttempt per ogni chiamata ai provider (WhatsApp → SMS → MANUAL_REQUIRED).

import type { AppointmentId, NotificationAttemptId, NotificationJobId, OperatorId } from '../ids';
import type { IsoDate, IsoDateTime } from '../value-objects/iso-date';
import type { PhoneE164 } from '../value-objects/phone';
import type { QueueCode } from '../value-objects/queue-code';

/** Tipo di messaggio. */
export type NotificationKind = 'REMINDER_MORNING' | 'YOUR_TURN' | 'VEHICLE_READY' | 'CUSTOM';

/** Canale di invio. */
export type NotificationChannel = 'WHATSAPP' | 'SMS' | 'MANUAL';

/** Provider concreto del tentativo. */
export type NotificationProvider = 'SPOKI' | 'SMS_HOSTING' | 'NONE';

/**
 * Stato del job.
 * - PENDING: creato, non ancora processato.
 * - IN_FLIGHT: in corso; se resta tale oltre una soglia (crash) viene riprocessato.
 * - SENT / DELIVERED: accettato / consegnato dal provider.
 * - FAILED: tutti i canali hanno fallito con errori `retryable` (es. timeout): retry
 *   automatico con backoff da M3, intanto confermabile a mano.
 * - MANUAL_REQUIRED: fallimento non retryable su tutti i canali → "Conferma contatto manuale".
 * - MANUAL_CONFIRMED: l'operatore ha contattato il cliente a mano.
 * - NO_RECIPIENT: la pratica non ha un recapito telefonico.
 * - SUPPRESSED: pratica annullata prima dell'invio (impostato da M3 su APPOINTMENT_STATUS_CHANGED).
 */
export type NotificationJobStatus =
  | 'PENDING'
  | 'IN_FLIGHT'
  | 'SENT'
  | 'DELIVERED'
  | 'FAILED'
  | 'MANUAL_REQUIRED'
  | 'MANUAL_CONFIRMED'
  | 'NO_RECIPIENT'
  | 'SUPPRESSED';

/** Esito di un singolo tentativo. */
export type NotificationAttemptOutcome = 'SENT' | 'DELIVERED' | 'FAILED';

/** Singola chiamata a un provider. */
export interface NotificationAttempt {
  readonly id: NotificationAttemptId;
  readonly jobId: NotificationJobId;
  readonly attemptNo: number;
  readonly channel: NotificationChannel;
  readonly provider: NotificationProvider;
  readonly providerMessageId: string | null;
  readonly outcome: NotificationAttemptOutcome;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly retryable: boolean;
  readonly latencyMs: number;
  readonly requestedAt: IsoDateTime;
  readonly respondedAt: IsoDateTime;
}

/** Messaggio logico da consegnare a un cliente per una pratica. */
export interface NotificationJob {
  readonly id: NotificationJobId;
  readonly appointmentId: AppointmentId;
  readonly businessDate: IsoDate;
  readonly kind: NotificationKind;
  /** `${appointmentId}:${kind}:${businessDate}`: nessun doppio invio dopo riavvii. */
  readonly idempotencyKey: string;
  readonly recipientPhone: PhoneE164 | null;
  /** Consenso WhatsApp del cliente al momento della creazione: decide se tentare Spoki anche nei retry. */
  readonly whatsappOptIn: boolean;
  /** Codice progressivo della pratica (F001): è ciò che il cliente legge nel messaggio, mai l'id tecnico. */
  readonly code: QueueCode;
  /** Variabili del template già risolte (firstName, code, scheduledTime, plate, brandName) per i template Spoki. */
  readonly templateVariables: Readonly<Record<string, string>>;
  readonly renderedText: string;
  readonly status: NotificationJobStatus;
  readonly currentChannel: NotificationChannel | null;
  readonly attempts: readonly NotificationAttempt[];
  readonly manualConfirmedBy: OperatorId | null;
  readonly manualNote: string | null;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

/** Chiave di idempotenza del job: `${appointmentId}:${kind}:${businessDate}`. */
export function buildNotificationIdempotencyKey(
  appointmentId: AppointmentId,
  kind: NotificationKind,
  businessDate: IsoDate,
): string {
  return `${appointmentId}:${kind}:${businessDate}`;
}
