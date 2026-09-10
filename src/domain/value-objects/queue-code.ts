// Codice progressivo della pratica (F001, F002…): identità immutabile
// comunicata al cliente, NON posizione in coda.

import type { Branded } from '../ids';

/** Codice progressivo assegnato alla pratica, es. "F001". */
export type QueueCode = Branded<string, 'QueueCode'>;

/** Numero minimo di cifre della sequenza (F001). Il dominio è l'unico proprietario di questa regola. */
export const CODE_PAD_LENGTH = 3;

const QUEUE_CODE_PATTERN = /^([A-Z]+)(\d+)$/;

/**
 * Formatta il codice: prefisso + sequenza con zeri iniziali a 3 cifre.
 * Oltre 999 il padding si allarga (F1000): mai un errore che blocchi l'operatore.
 */
export function formatQueueCode(prefix: string, sequence: number): QueueCode {
  const safeSequence = Number.isFinite(sequence) && sequence >= 0 ? Math.floor(sequence) : 0;
  return `${prefix}${String(safeSequence).padStart(CODE_PAD_LENGTH, '0')}` as QueueCode;
}

/** Scompone un codice in prefisso e sequenza; `null` se il formato non è riconosciuto. */
export function parseQueueCode(code: string): { prefix: string; sequence: number } | null {
  const match = QUEUE_CODE_PATTERN.exec(code.trim().toUpperCase());
  if (match === null) {
    return null;
  }
  const prefix = match[1];
  const digits = match[2];
  if (prefix === undefined || digits === undefined) {
    return null;
  }
  return { prefix, sequence: Number.parseInt(digits, 10) };
}

/** Elemento ordinabile della coda: orario di prenotazione e sequenza del codice. */
export interface ScheduleOrderable {
  readonly scheduledAt: string;
  readonly sequence: number;
}

/**
 * Ordinamento canonico della coda: prima per orario di prenotazione (ISO UTC,
 * confronto lessicografico), a pari orario per sequenza del codice.
 */
export function compareByScheduleThenSequence(a: ScheduleOrderable, b: ScheduleOrderable): number {
  if (a.scheduledAt < b.scheduledAt) {
    return -1;
  }
  if (a.scheduledAt > b.scheduledAt) {
    return 1;
  }
  return a.sequence - b.sequence;
}
