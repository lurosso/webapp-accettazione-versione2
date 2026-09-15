// Configurazione e contratto dell'integrazione Spoki (WhatsApp Business via "Automazioni").
//
// Spoki espone un URL di webhook per ogni automazione: chiamandolo con i dati del contatto,
// Spoki invia il template WhatsApp collegato. Qui i tre template del progetto (conferma, turno
// in arrivo, annullamento) sono mappati alle chiavi dei template usate dall'orchestratore.
// Lo schema del payload è quello che l'adapter invia: campi piatti e nomi in snake_case, così
// nell'automazione Spoki si mappano come variabili. Da confermare sulla documentazione del
// proprio account quando si passa a `live` (in `simulation` non parte nulla).
import type { SpokiMode } from '@/services/interfaces/provider-kinds';

/** I tre template del progetto, uno per URL di automazione. */
export type SpokiTemplateKind = 'CONFIRMATION' | 'TURN_APPROACHING' | 'CANCELLATION';

export const SPOKI_TEMPLATE_KINDS: readonly SpokiTemplateKind[] = [
  'CONFIRMATION',
  'TURN_APPROACHING',
  'CANCELLATION',
];

/** Da chiave del template Meta (usata dall'orchestratore) al template Spoki. */
export const TEMPLATE_KIND_BY_KEY: Readonly<Record<string, SpokiTemplateKind>> = {
  booking_confirmed_v1: 'CONFIRMATION',
  turn_approaching_v1: 'TURN_APPROACHING',
  appointment_cancelled_v1: 'CANCELLATION',
};

/** Variabile d'ambiente che porta l'URL di ciascun template. */
export const SPOKI_URL_ENV_KEYS: Readonly<Record<SpokiTemplateKind, string>> = {
  CONFIRMATION: 'SPOKI_URL_CONFIRMATION',
  TURN_APPROACHING: 'SPOKI_URL_TURN_APPROACHING',
  CANCELLATION: 'SPOKI_URL_CANCELLATION',
};

export interface SpokiServiceConfig {
  readonly mode: SpokiMode;
  /** Chiave API globale dell'account (menu "Integrazioni API" di Spoki); null se non impostata. */
  readonly apiKey: string | null;
  readonly urls: Readonly<Record<SpokiTemplateKind, string | null>>;
  /** Tempo massimo per una chiamata live. */
  readonly timeoutMs: number;
}

/** Payload inviato all'automazione Spoki: campi piatti, pronti per le variabili del template. */
export interface SpokiWebhookPayload {
  readonly phone: string;
  readonly first_name: string;
  readonly code: string;
  readonly plate: string;
  readonly scheduled_time: string;
  readonly brand: string;
  readonly portal_url: string;
  /** Testo già renderizzato in italiano: utile se l'automazione usa un unico campo libero. */
  readonly text: string;
  readonly template: string;
  readonly correlation_id: string;
  readonly idempotency_key: string;
}

/** Ultime quattro cifre visibili: basta per riconoscere il numero nel registro. */
export function maskForLog(phone: string): string {
  return phone.length <= 4 ? '****' : `${'*'.repeat(phone.length - 4)}${phone.slice(-4)}`;
}
