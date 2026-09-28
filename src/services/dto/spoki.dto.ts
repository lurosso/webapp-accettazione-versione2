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

/** Lettura dei campi personalizzati di un contatto Spoki, senza scrivere niente. */
export interface SpokiContactReadDto {
  readonly to: PhoneE164;
  /** Codici dei campi da leggere (MAIUSCOLO, es. ACC_PULSANTE). */
  readonly codes: readonly string[];
  readonly correlationId: string;
}

/** Esito della lettura. */
export interface SpokiContactFieldsReceipt {
  /** False quando la chiamata è rimasta bloccata (simulazione, blocco di sicurezza, demo). */
  readonly read: boolean;
  /** False se in Spoki non c'è un contatto con quel numero. */
  readonly found: boolean;
  /** I campi chiesti che il contatto ha, per codice; un campo che non ha non compare. */
  readonly fields: Readonly<Record<string, string>>;
}

/**
 * Prefisso dell'identificativo di un invio fermato dal guardrail (simulazione, safety lock, demo
 * interna): il messaggio risulta «partito» per il flusso dell'app, ma a Spoki non è arrivato niente.
 */
export const SPOKI_SIMULATED_MESSAGE_ID_PREFIX = 'sim-';

/** Il campo del contatto con lo stato del promemoria del mattino. */
export const SPOKI_REMINDER_STATE_FIELD = 'ACC_PROMEMORIA';

/**
 * Il campo del contatto con il pulsante toccato sul promemoria del mattino. Lo scrivono le
 * automazioni Spoki dei tre pulsanti (solo se `ACC_PROMEMORIA = INVIATO`); l'app lo legge a
 * intervalli e, dopo averlo applicato alla pratica, lo rimette a `ATTESA` (docs/SPOKI.md).
 */
export const SPOKI_BUTTON_FIELD = 'ACC_PULSANTE';

/** Valori di `ACC_PULSANTE`: `ATTESA` = niente da leggere. */
export type SpokiButtonState = 'ATTESA' | 'ARRIVATO' | 'RITARDO' | 'ASSENTE';

/** Il valore scritto dall'automazione di ciascun pulsante → payload del pulsante nell'app. */
export const SPOKI_BUTTON_PAYLOADS: Readonly<
  Record<Exclude<SpokiButtonState, 'ATTESA'>, 'ACTION_ARRIVED' | 'ACTION_LATE' | 'ACTION_ABSENT'>
> = {
  ARRIVATO: 'ACTION_ARRIVED',
  RITARDO: 'ACTION_LATE',
  ASSENTE: 'ACTION_ABSENT',
};

/**
 * Valori di `ACC_PROMEMORIA`. Lo legge la rete di sicurezza in Spoki: se all'ora prevista vale
 * ancora `DA_INVIARE`, il server non ha mandato il promemoria e ci pensa l'automazione.
 * - `DA_INVIARE`: scritto dal promemoria del giorno prima (domani il cliente lo aspetta);
 * - `INVIATO`: scritto da qualunque messaggio del giorno stesso (il promemoria o le risposte);
 * - `NON_SERVE`: scritto dall'app quando la pratica non deve riceverlo (annullata, già arrivata).
 */
export type SpokiReminderState = 'DA_INVIARE' | 'INVIATO' | 'NON_SERVE';
