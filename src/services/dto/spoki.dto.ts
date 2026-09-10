// Richiesta di invio verso Spoki (WhatsApp template).

import type { PhoneE164 } from '@/domain/value-objects/phone';

/** Invio di un messaggio template WhatsApp. */
export interface SpokiSendRequestDto {
  /** Chiave di idempotenza: stesso valore → stessa ricevuta, nessun doppio invio. */
  readonly idempotencyKey: string;
  readonly to: PhoneE164;
  /** Chiave del template approvato da Meta (es. "reminder_morning_v1"). */
  readonly templateKey: string;
  /** Variabili del template; la chiave `text` contiene il testo renderizzato per i log. */
  readonly variables: Readonly<Record<string, string>>;
  readonly correlationId: string;
}
