// Outbox delle notifiche: un NotificationJob per messaggio logico, un
// NotificationAttempt per ogni chiamata ai provider (WhatsApp → SMS → MANUAL_REQUIRED).

import type { AppointmentId, NotificationAttemptId, NotificationJobId, OperatorId } from '../ids';
import type { IsoDate, IsoDateTime } from '../value-objects/iso-date';
import type { PhoneE164 } from '../value-objects/phone';
import type { QueueCode } from '../value-objects/queue-code';

/**
 * Tipo di messaggio.
 * - REMINDER_PREVIOUS_DAY: promemoria del giorno prima (data, ora, targa, codice, link al portale);
 * - REMINDER_SAME_DAY: promemoria della mattina per l'appuntamento di oggi (ora, targa, codice);
 * - CHECK_IN_STARTED: la pratica è stata presa in carico allo sportello: benvenuto con il link
 *   personale al portale, dove il cliente segue l'accettazione in tempo reale;
 * - CHECK_IN_COMPLETED: il check-in (foto e video) è concluso: «Procedura di accettazione
 *   completata. Grazie per la visita, puoi proseguire!»;
 * - BOOKING_CONFIRMED: pratica inserita a mano al banco (le pratiche dell'agenda hanno il promemoria);
 * - TURN_APPROACHING: davanti al cliente restano poche pratiche del suo sportello;
 * - YOUR_TURN: è il suo turno;
 * - APPOINTMENT_CANCELLED: pratica annullata da una persona (non dalla chiusura automatica);
 * - VEHICLE_READY: vettura pronta al ritiro;
 * - CUSTOM: testo libero dell'operatore.
 * L'integrazione Spoki copre i due promemoria e i due messaggi del check-in; gli altri tipi
 * restano definiti per l'orchestratore (SMS, log) e per il futuro.
 */
export type NotificationKind =
  | 'REMINDER_PREVIOUS_DAY'
  | 'REMINDER_SAME_DAY'
  | 'CHECK_IN_STARTED'
  | 'CHECK_IN_COMPLETED'
  /** Risposta automatica a chi ha toccato «Sono arrivato»: codice in coda e smart link al tracciamento. */
  | 'ARRIVAL_CONFIRMED'
  /** Risposta automatica a chi ha toccato «In ritardo»: l'accettazione è avvisata. */
  | 'LATE_CONFIRMED'
  /** Risposta automatica a chi ha toccato «Non posso venire»: prenotazione annullata, il BDC richiama. */
  | 'ABSENT_CONFIRMED'
  /** Risposta a chi tocca «Sono arrivato» troppo presto: non è in fila, ripremere vicino all'orario. */
  | 'ARRIVAL_TOO_EARLY'
  | 'BOOKING_CONFIRMED'
  | 'TURN_APPROACHING'
  | 'YOUR_TURN'
  | 'APPOINTMENT_CANCELLED'
  | 'VEHICLE_READY'
  | 'CUSTOM';

/** Canale di invio. */
export type NotificationChannel = 'WHATSAPP' | 'SMS' | 'MANUAL';

/** Provider concreto del tentativo. */
export type NotificationProvider = 'SPOKI' | 'SMS_HOSTING' | 'NONE';

/**
 * Stato del job.
 * - PENDING: creato, non ancora processato.
 * - IN_FLIGHT: in corso; se resta tale oltre una soglia (crash) viene riprocessato.
 * - SENT / DELIVERED / READ: accettato / consegnato / letto dal cliente (READ solo da WhatsApp,
 *   quando Spoki lo comunica con il webhook di esito).
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
  | 'READ'
  | 'FAILED'
  | 'MANUAL_REQUIRED'
  | 'MANUAL_CONFIRMED'
  | 'NO_RECIPIENT'
  | 'SUPPRESSED';

/** Esito di un singolo tentativo. */
export type NotificationAttemptOutcome = 'SENT' | 'DELIVERED' | 'FAILED';

/**
 * Esito di un contatto fatto a mano, registrato da chi chiude la segnalazione nella schermata
 * Comunicazioni. È la risposta alla domanda «il cliente sa quello che doveva sapere?».
 */
export const MANUAL_CONTACT_OUTCOMES = [
  'PHONE_CALLED',
  'INFORMED_AT_DESK',
  'UNREACHABLE',
  'WRONG_NUMBER',
  'OTHER',
] as const;

export type ManualContactOutcome = (typeof MANUAL_CONTACT_OUTCOMES)[number];

export const MANUAL_CONTACT_OUTCOME_LABELS: Readonly<Record<ManualContactOutcome, string>> = {
  PHONE_CALLED: 'Cliente chiamato al telefono',
  INFORMED_AT_DESK: 'Cliente informato di persona',
  UNREACHABLE: 'Cliente non raggiungibile',
  WRONG_NUMBER: 'Numero errato o inesistente',
  OTHER: 'Altro (vedi nota)',
};

export function isManualContactOutcome(v: unknown): v is ManualContactOutcome {
  return typeof v === 'string' && (MANUAL_CONTACT_OUTCOMES as readonly string[]).includes(v);
}

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
  /** Esito registrato chiudendo a mano la segnalazione; null finché non è chiusa. */
  readonly manualOutcome: ManualContactOutcome | null;
  readonly manualConfirmedAt: IsoDateTime | null;
  /**
   * Prossimo tentativo automatico di un job FAILED; null = nessuna riprova programmata (riuscito,
   * da contattare a mano, oppure tentativi esauriti).
   */
  readonly nextAttemptAt: IsoDateTime | null;
  /** Riprove automatiche già fatte (il primo invio non conta). */
  readonly autoRetryCount: number;
  /** Chi ha preso in carico il contatto dalla schermata Comunicazioni, e quando. */
  readonly claimedByOperatorId: OperatorId | null;
  readonly claimedByName: string | null;
  readonly claimedAt: IsoDateTime | null;
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
