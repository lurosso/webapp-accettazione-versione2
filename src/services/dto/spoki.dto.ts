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

/**
 * Aggiornamento dei campi personalizzati di un contatto Spoki, senza mandare messaggi (per esempio
 * per disarmare la rete di sicurezza del promemoria del mattino).
 */
export interface SpokiContactUpdateDto {
  readonly to: PhoneE164;
  /** Campi del contatto per codice Spoki (MAIUSCOLO, es. ACC_PROMEMORIA). */
  readonly fields: Readonly<Record<string, string>>;
  readonly correlationId: string;
}

/** Esito dell'aggiornamento: false quando la chiamata è rimasta bloccata (simulazione, demo). */
export interface SpokiContactUpdateReceipt {
  readonly updated: boolean;
}

/** Il campo del contatto con lo stato del promemoria del mattino. */
export const SPOKI_REMINDER_STATE_FIELD = 'ACC_PROMEMORIA';

/**
 * Valori di `ACC_PROMEMORIA`. Lo legge la rete di sicurezza in Spoki: se all'ora prevista vale
 * ancora `DA_INVIARE`, il server non ha mandato il promemoria e ci pensa l'automazione.
 * - `DA_INVIARE`: scritto dal promemoria del giorno prima (domani il cliente lo aspetta);
 * - `INVIATO`: scritto da qualunque messaggio del giorno stesso (il promemoria o le risposte);
 * - `NON_SERVE`: scritto dall'app quando la pratica non deve riceverlo (annullata, già arrivata).
 */
export type SpokiReminderState = 'DA_INVIARE' | 'INVIATO' | 'NON_SERVE';
