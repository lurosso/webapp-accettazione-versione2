// Configurazione e contratto dell'integrazione Spoki (WhatsApp Business via "Automazioni").
//
// Spoki espone un URL di webhook per ogni automazione: chiamandolo con i dati del contatto,
// Spoki invia il template WhatsApp collegato. Il payload è quello documentato da Spoki:
//   { secret, phone, first_name, last_name, email, custom_fields: { … } }
// dove `secret` è il segreto della singola automazione e i campi dinamici del messaggio (codice,
// targa, orario, data, link al portale) viaggiano in `custom_fields`.
//
// Perimetro attuale: SOLO i due promemoria (giorno prima e giorno stesso). Gli altri template
// restano definiti perché l'orchestratore li usa per SMS e log, ma non hanno automazione.
//
// GUARDRAIL: nessuna chiamata HTTP parte se `SPOKI_MODE` non è `live` oppure se
// `SPOKI_SAFETY_LOCK` è attivo (predefinito). In quel caso il payload viene solo formattato,
// scritto nei log e nel registro del pannello admin. Vedi `canDeliverLive`.
import type { SpokiMode } from '@/services/interfaces/provider-kinds';

/** I template del progetto, uno per URL di automazione. */
export type SpokiTemplateKind =
  | 'REMINDER_PREVIOUS_DAY'
  | 'REMINDER_SAME_DAY'
  | 'CONFIRMATION'
  | 'TURN_APPROACHING'
  | 'CANCELLATION';

export const SPOKI_TEMPLATE_KINDS: readonly SpokiTemplateKind[] = [
  'REMINDER_PREVIOUS_DAY',
  'REMINDER_SAME_DAY',
  'CONFIRMATION',
  'TURN_APPROACHING',
  'CANCELLATION',
];

/** I soli template integrati in questa fase: gli altri non hanno automazione configurabile. */
export const SPOKI_ACTIVE_TEMPLATE_KINDS: readonly SpokiTemplateKind[] = [
  'REMINDER_PREVIOUS_DAY',
  'REMINDER_SAME_DAY',
];

/** Da chiave del template Meta (usata dall'orchestratore) al template Spoki. */
export const TEMPLATE_KIND_BY_KEY: Readonly<Record<string, SpokiTemplateKind>> = {
  reminder_previous_day_v1: 'REMINDER_PREVIOUS_DAY',
  reminder_same_day_v1: 'REMINDER_SAME_DAY',
  booking_confirmed_v1: 'CONFIRMATION',
  turn_approaching_v1: 'TURN_APPROACHING',
  appointment_cancelled_v1: 'CANCELLATION',
};

/** Variabile d'ambiente che porta l'URL di ciascun template. */
export const SPOKI_URL_ENV_KEYS: Readonly<Record<SpokiTemplateKind, string>> = {
  REMINDER_PREVIOUS_DAY: 'SPOKI_URL_REMINDER_PREVIOUS_DAY',
  REMINDER_SAME_DAY: 'SPOKI_URL_REMINDER_SAME_DAY',
  CONFIRMATION: 'SPOKI_URL_CONFIRMATION',
  TURN_APPROACHING: 'SPOKI_URL_TURN_APPROACHING',
  CANCELLATION: 'SPOKI_URL_CANCELLATION',
};

/** Variabile d'ambiente che porta il segreto dell'automazione (va nel payload, campo `secret`). */
export const SPOKI_SECRET_ENV_KEYS: Readonly<Record<SpokiTemplateKind, string>> = {
  REMINDER_PREVIOUS_DAY: 'SPOKI_SECRET_REMINDER_PREVIOUS_DAY',
  REMINDER_SAME_DAY: 'SPOKI_SECRET_REMINDER_SAME_DAY',
  CONFIRMATION: 'SPOKI_SECRET_CONFIRMATION',
  TURN_APPROACHING: 'SPOKI_SECRET_TURN_APPROACHING',
  CANCELLATION: 'SPOKI_SECRET_CANCELLATION',
};

export interface SpokiServiceConfig {
  readonly mode: SpokiMode;
  /**
   * Blocco di sicurezza (env SPOKI_SAFETY_LOCK, predefinito true): finché è attivo NESSUN
   * WhatsApp parte verso un telefono reale, nemmeno con `mode = live`.
   */
  readonly safetyLock: boolean;
  /** Chiave API globale dell'account (menu "Integrazioni API" di Spoki); null se non impostata. */
  readonly apiKey: string | null;
  readonly urls: Readonly<Record<SpokiTemplateKind, string | null>>;
  /** Segreto per automazione, inserito nel payload come richiesto da Spoki. */
  readonly secrets: Readonly<Record<SpokiTemplateKind, string | null>>;
  /** Tempo massimo per una chiamata live. */
  readonly timeoutMs: number;
}

/** Campi dinamici del messaggio, come li vede l'automazione Spoki. */
export interface SpokiCustomFields {
  /** Codice della pratica in coda (es. F041). */
  readonly code: string;
  /** Targa del veicolo. */
  readonly plate: string;
  /** Orario dell'appuntamento, "HH:mm" locale (es. 09:30). */
  readonly time: string;
  /** Data dell'appuntamento, "GG/MM/AAAA" (serve al promemoria del giorno prima). */
  readonly date: string;
  /** Link al portale cliente: `${PUBLIC_BASE_URL}/portal?targa=${plate}`. */
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

/** Copia del payload adatta a log e registro (segreto mascherato). */
export function payloadForLog(payload: SpokiWebhookPayload): Readonly<Record<string, unknown>> {
  return { ...payload, secret: maskSecret(payload.secret) };
}
