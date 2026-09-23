// Configurazione e contratto dell'integrazione Spoki (WhatsApp Business API).
//
// Due modi di far partire un template, entrambi documentati da Spoki:
// - AUTOMAZIONE: ogni automazione espone un URL (`https://api.spoki.com/wh/ap/<uuid>/`) che si
//   chiama con il segreto dell'automazione nel payload:
//     { secret, phone, first_name, last_name, email, custom_fields: { … } }
//   Configurata con SPOKI_URL_* e SPOKI_SECRET_*.
// - TEMPLATE via API: `POST https://api.spoki.com/api/1/messages/send/` con la chiave API
//   dell'account nell'intestazione `X-Spoki-Api-Key` e il template approvato da Meta per id:
//     { type: "Template", phone, template: <id>, language, custom_fields: { … }, buttons, metadata }
//   Configurata con SPOKI_TEMPLATE_*_ID. I pulsanti rapidi del promemoria del giorno stesso
//   («Sono arrivato», «In ritardo», «Non posso venire») viaggiano con un payload tecnico
//   (ACTION_ARRIVED, ACTION_LATE, ACTION_ABSENT) che Spoki rimanda nel webhook `message.inbound`.
//
// Per ogni template vince l'id se configurato, altrimenti l'URL dell'automazione; senza nessuno
// dei due si sceglie in base alla variabile prevista, così in simulazione il registro dice cosa
// manca.
//
// GUARDRAIL: nessuna chiamata HTTP parte se `SPOKI_MODE` non è `live` oppure se
// `SPOKI_SAFETY_LOCK` è attivo (predefinito). Con `SPOKI_ENABLED=false` (predefinito) o senza
// chiave API la configurazione stessa forza `simulation` (vedi `config/env.ts`). In tutti questi
// casi il payload viene solo formattato, scritto nei log e nel registro del pannello admin.
import type { SpokiMode } from '@/services/interfaces/provider-kinds';

/** I template del progetto. */
export type SpokiTemplateKind =
  | 'REMINDER_PREVIOUS_DAY'
  | 'REMINDER_SAME_DAY'
  | 'ARRIVAL_CONFIRMED'
  | 'LATE_CONFIRMED'
  | 'ABSENT_CONFIRMED'
  | 'ARRIVAL_TOO_EARLY'
  | 'CHECK_IN_STARTED'
  | 'CHECK_IN_COMPLETED'
  | 'CONFIRMATION'
  | 'TURN_APPROACHING'
  | 'CANCELLATION';

export const SPOKI_TEMPLATE_KINDS: readonly SpokiTemplateKind[] = [
  'REMINDER_PREVIOUS_DAY',
  'REMINDER_SAME_DAY',
  'ARRIVAL_CONFIRMED',
  'LATE_CONFIRMED',
  'ABSENT_CONFIRMED',
  'ARRIVAL_TOO_EARLY',
  'CHECK_IN_STARTED',
  'CHECK_IN_COMPLETED',
  'CONFIRMATION',
  'TURN_APPROACHING',
  'CANCELLATION',
];

/**
 * I template integrati: i due promemoria, le tre risposte automatiche ai pulsanti del promemoria
 * del giorno stesso e i due messaggi del check-in. Gli altri restano definiti per SMS e log ma
 * non hanno una configurazione Spoki.
 */
export const SPOKI_ACTIVE_TEMPLATE_KINDS: readonly SpokiTemplateKind[] = [
  'REMINDER_PREVIOUS_DAY',
  'REMINDER_SAME_DAY',
  'ARRIVAL_CONFIRMED',
  'LATE_CONFIRMED',
  'ABSENT_CONFIRMED',
  'ARRIVAL_TOO_EARLY',
  'CHECK_IN_STARTED',
  'CHECK_IN_COMPLETED',
];

/** Da chiave del template Meta (usata dall'orchestratore) al template Spoki. */
export const TEMPLATE_KIND_BY_KEY: Readonly<Record<string, SpokiTemplateKind>> = {
  reminder_previous_day_v1: 'REMINDER_PREVIOUS_DAY',
  reminder_same_day_v1: 'REMINDER_SAME_DAY',
  arrival_confirmed_v1: 'ARRIVAL_CONFIRMED',
  late_confirmed_v1: 'LATE_CONFIRMED',
  absent_confirmed_v1: 'ABSENT_CONFIRMED',
  arrival_too_early_v1: 'ARRIVAL_TOO_EARLY',
  check_in_started_v1: 'CHECK_IN_STARTED',
  check_in_completed_v1: 'CHECK_IN_COMPLETED',
  booking_confirmed_v1: 'CONFIRMATION',
  turn_approaching_v1: 'TURN_APPROACHING',
  appointment_cancelled_v1: 'CANCELLATION',
};

/** Variabile d'ambiente che porta l'URL dell'automazione di ciascun template. */
export const SPOKI_URL_ENV_KEYS: Readonly<Record<SpokiTemplateKind, string>> = {
  REMINDER_PREVIOUS_DAY: 'SPOKI_URL_REMINDER_PREVIOUS_DAY',
  REMINDER_SAME_DAY: 'SPOKI_URL_REMINDER_SAME_DAY',
  ARRIVAL_CONFIRMED: 'SPOKI_URL_ARRIVAL_CONFIRMED',
  LATE_CONFIRMED: 'SPOKI_URL_LATE_CONFIRMED',
  ABSENT_CONFIRMED: 'SPOKI_URL_ABSENT_CONFIRMED',
  ARRIVAL_TOO_EARLY: 'SPOKI_URL_ARRIVAL_TOO_EARLY',
  CHECK_IN_STARTED: 'SPOKI_URL_CHECK_IN_STARTED',
  CHECK_IN_COMPLETED: 'SPOKI_URL_CHECK_IN_COMPLETED',
  CONFIRMATION: 'SPOKI_URL_CONFIRMATION',
  TURN_APPROACHING: 'SPOKI_URL_TURN_APPROACHING',
  CANCELLATION: 'SPOKI_URL_CANCELLATION',
};

/** Variabile d'ambiente che porta il segreto dell'automazione (va nel payload, campo `secret`). */
export const SPOKI_SECRET_ENV_KEYS: Readonly<Record<SpokiTemplateKind, string>> = {
  REMINDER_PREVIOUS_DAY: 'SPOKI_SECRET_REMINDER_PREVIOUS_DAY',
  REMINDER_SAME_DAY: 'SPOKI_SECRET_REMINDER_SAME_DAY',
  ARRIVAL_CONFIRMED: 'SPOKI_SECRET_ARRIVAL_CONFIRMED',
  LATE_CONFIRMED: 'SPOKI_SECRET_LATE_CONFIRMED',
  ABSENT_CONFIRMED: 'SPOKI_SECRET_ABSENT_CONFIRMED',
  ARRIVAL_TOO_EARLY: 'SPOKI_SECRET_ARRIVAL_TOO_EARLY',
  CHECK_IN_STARTED: 'SPOKI_SECRET_CHECK_IN_STARTED',
  CHECK_IN_COMPLETED: 'SPOKI_SECRET_CHECK_IN_COMPLETED',
  CONFIRMATION: 'SPOKI_SECRET_CONFIRMATION',
  TURN_APPROACHING: 'SPOKI_SECRET_TURN_APPROACHING',
  CANCELLATION: 'SPOKI_SECRET_CANCELLATION',
};

/**
 * Variabile d'ambiente con l'id del template Meta per l'invio via API; null per i template che
 * non hanno un invio via API previsto.
 */
export const SPOKI_TEMPLATE_ID_ENV_KEYS: Readonly<Record<SpokiTemplateKind, string | null>> = {
  REMINDER_PREVIOUS_DAY: 'SPOKI_TEMPLATE_REMINDER_D1_ID',
  REMINDER_SAME_DAY: 'SPOKI_TEMPLATE_SAME_DAY_ID',
  ARRIVAL_CONFIRMED: 'SPOKI_TEMPLATE_ARRIVED_REPLY_ID',
  LATE_CONFIRMED: 'SPOKI_TEMPLATE_LATE_REPLY_ID',
  ABSENT_CONFIRMED: 'SPOKI_TEMPLATE_ABSENT_REPLY_ID',
  ARRIVAL_TOO_EARLY: 'SPOKI_TEMPLATE_EARLY_REPLY_ID',
  CHECK_IN_STARTED: 'SPOKI_TEMPLATE_WELCOME_ID',
  CHECK_IN_COMPLETED: 'SPOKI_TEMPLATE_COMPLETE_ID',
  CONFIRMATION: null,
  TURN_APPROACHING: null,
  CANCELLATION: null,
};

/** Payload tecnici dei pulsanti rapidi: sono quelli che Spoki rimanda nel webhook `message.inbound`. */
export const SPOKI_QUICK_REPLY_PAYLOADS = [
  'ACTION_ARRIVED',
  'ACTION_LATE',
  'ACTION_ABSENT',
] as const;

export type SpokiQuickReplyPayload = (typeof SPOKI_QUICK_REPLY_PAYLOADS)[number];

/** Un pulsante rapido del template: ordine, etichetta (come nel template Meta) e payload. */
export interface SpokiQuickReply {
  readonly order: number;
  readonly label: string;
  readonly payload: SpokiQuickReplyPayload;
}

/**
 * Pulsanti per template. Il promemoria del giorno stesso ne ha tre: il cliente tocca e Spoki
 * rimanda il payload, che il webhook traduce in «arrivato», «in ritardo», «assente».
 */
export const SPOKI_QUICK_REPLIES: Readonly<
  Partial<Record<SpokiTemplateKind, readonly SpokiQuickReply[]>>
> = {
  REMINDER_SAME_DAY: [
    { order: 0, label: 'SONO_ARRIVATO', payload: 'ACTION_ARRIVED' },
    { order: 1, label: 'IN_RITARDO', payload: 'ACTION_LATE' },
    { order: 2, label: 'NON_POSSO_VENIRE', payload: 'ACTION_ABSENT' },
  ],
};

/** Indirizzo ufficiale delle API Spoki (percorsi `/api/1/…`); sovrascrivibile con SPOKI_API_BASE_URL. */
export const SPOKI_DEFAULT_API_BASE_URL = 'https://api.spoki.com';

/** Percorso dell'invio di un template via API. */
export const SPOKI_SEND_PATH = '/api/1/messages/send/';

export interface SpokiServiceConfig {
  readonly mode: SpokiMode;
  /**
   * Blocco di sicurezza (env SPOKI_SAFETY_LOCK, predefinito true): finché è attivo NESSUN
   * WhatsApp parte verso un telefono reale, nemmeno con `mode = live`.
   */
  readonly safetyLock: boolean;
  /** Chiave API dell'account (menu "Integrazioni API" di Spoki, intestazione X-Spoki-Api-Key); null se non impostata. */
  readonly apiKey: string | null;
  /** Base delle API (senza barra finale). */
  readonly apiBaseUrl: string;
  /** URL delle automazioni, per template. */
  readonly urls: Readonly<Record<SpokiTemplateKind, string | null>>;
  /** Segreto per automazione, inserito nel payload come richiesto da Spoki. */
  readonly secrets: Readonly<Record<SpokiTemplateKind, string | null>>;
  /** Id del template Meta per l'invio via API; ha la precedenza sull'automazione se impostato. */
  readonly templates: Readonly<Record<SpokiTemplateKind, string | null>>;
  /** Tempo massimo per una chiamata live. */
  readonly timeoutMs: number;
}

/** Campi dinamici del messaggio, come li vedono l'automazione o il template Spoki. */
export interface SpokiCustomFields {
  /** Codice della pratica in coda (es. F041). */
  readonly code: string;
  /** Targa del veicolo. */
  readonly plate: string;
  /** Orario dell'appuntamento, "HH:mm" locale (es. 09:30). */
  readonly time: string;
  /** Data dell'appuntamento, "GG/MM/AAAA" (serve al promemoria del giorno prima). */
  readonly date: string;
  /** Smart link personale al portale cliente: `${PUBLIC_BASE_URL}/portal/<token>`. */
  readonly portal_url: string;
}

/** Payload inviato all'automazione Spoki, nel formato documentato dal fornitore. */
export interface SpokiWebhookPayload {
  /** Segreto dell'automazione; in simulazione può essere vuoto. */
  readonly secret: string;
  /** Numero in formato E.164 (+39…): è l'unico campo obbligatorio per Spoki. */
  readonly phone: string;
  readonly first_name: string;
  readonly last_name: string;
  readonly email: string;
  readonly custom_fields: SpokiCustomFields;
}

/**
 * Metadati allegati all'invio via API: Spoki li rimanda nel webhook di esito (`data.metadata`),
 * così il messaggio si ritrova anche senza il suo id. Nessun dato personale: solo chiavi tecniche.
 */
export interface SpokiSendMetadata {
  /** Chiave di idempotenza del tentativo (job:canale:numero). */
  readonly idempotency_key: string;
  readonly template_kind: SpokiTemplateKind;
  readonly correlation_id: string;
}

/** Pulsante nel payload di invio: ordine e payload che tornerà nel webhook. */
export interface SpokiSendButton {
  readonly order: number;
  readonly payload: string;
}

/** Payload di `POST /api/1/messages/send/` per un template approvato (formato Spoki). */
export interface SpokiTemplateSendPayload {
  readonly type: 'Template';
  /** Numero in formato E.164. */
  readonly phone: string;
  /** Id numerico del template in Spoki (si legge dalla pagina del template). */
  readonly template: number | string;
  readonly language: string;
  readonly first_name: string;
  readonly last_name: string;
  /** Spoki accetta l'e-mail vuota: si manda sempre, come nell'automazione. */
  readonly email: string;
  readonly custom_fields: SpokiCustomFields;
  /** Pulsanti rapidi con il payload da ricevere nel webhook; solo per i template che li hanno. */
  readonly buttons?: readonly SpokiSendButton[];
  readonly metadata: SpokiSendMetadata;
}

/** Trasporto scelto per un template: automazione (URL + segreto) o API (template id + chiave). */
export type SpokiTransport =
  | {
      readonly kind: 'AUTOMATION';
      /** URL dell'automazione; null se non configurato (in simulazione si registra comunque). */
      readonly url: string | null;
      readonly payload: SpokiWebhookPayload;
    }
  | {
      readonly kind: 'TEMPLATE';
      /** Id del template; null se non configurato (in simulazione si registra comunque). */
      readonly templateId: string | null;
      readonly payload: SpokiTemplateSendPayload;
    };

/**
 * Quale trasporto usa un template: l'id del template se configurato, altrimenti l'URL
 * dell'automazione se configurato; senza nessuno dei due, quello che la configurazione prevede
 * (l'id se il template ha una variabile SPOKI_TEMPLATE_*_ID, altrimenti l'automazione).
 */
export function resolveTransportKind(
  kind: SpokiTemplateKind,
  templateId: string | null,
  url: string | null,
): 'TEMPLATE' | 'AUTOMATION' {
  if (templateId !== null) {
    return 'TEMPLATE';
  }
  if (url !== null) {
    return 'AUTOMATION';
  }
  return SPOKI_TEMPLATE_ID_ENV_KEYS[kind] !== null ? 'TEMPLATE' : 'AUTOMATION';
}

/**
 * Regola unica del guardrail: la chiamata HTTP verso Spoki è ammessa solo con `mode = live` E
 * blocco di sicurezza disattivato. Tutto il resto è formattazione e log.
 */
export function canDeliverLive(mode: SpokiMode, safetyLock: boolean): boolean {
  return mode === 'live' && !safetyLock;
}

/** Motivo per cui la chiamata non parte (null se può partire). */
export function deliveryBlockReason(
  mode: SpokiMode,
  safetyLock: boolean,
): 'SIMULATION' | 'SAFETY_LOCK' | null {
  if (mode !== 'live') {
    return 'SIMULATION';
  }
  return safetyLock ? 'SAFETY_LOCK' : null;
}

/** URL completo dell'invio via API a partire dalla base configurata. */
export function spokiSendUrl(apiBaseUrl: string): string {
  return `${apiBaseUrl.replace(/\/+$/, '')}${SPOKI_SEND_PATH}`;
}

/** Ultime quattro cifre visibili: basta per riconoscere il numero nel registro. */
export function maskForLog(phone: string): string {
  return phone.length <= 4 ? '****' : `${'*'.repeat(phone.length - 4)}${phone.slice(-4)}`;
}

/** Segreto dell'automazione mascherato per log e registro: mai in chiaro fuori dalla richiesta. */
export function maskSecret(secret: string): string {
  if (secret === '') {
    return '';
  }
  return secret.length <= 8 ? '••••' : `${secret.slice(0, 4)}••••${secret.slice(-4)}`;
}

/** Copia del payload adatta a log e registro (segreto mascherato, se c'è). */
export function payloadForLog(
  payload: SpokiWebhookPayload | SpokiTemplateSendPayload,
): Readonly<Record<string, unknown>> {
  return 'secret' in payload ? { ...payload, secret: maskSecret(payload.secret) } : { ...payload };
}
