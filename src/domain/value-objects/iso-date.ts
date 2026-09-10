// Tipi data/ora come stringhe serializzabili: IsoDate (giornata operativa YYYY-MM-DD
// in Europe/Rome) e IsoDateTime (istante ISO 8601 in UTC).

import type { Branded } from '../ids';

/** Giornata operativa nel formato YYYY-MM-DD, calcolata nel fuso Europe/Rome. */
export type IsoDate = Branded<string, 'IsoDate'>;

/** Istante ISO 8601 in UTC (es. 2026-09-10T05:30:00.000Z). */
export type IsoDateTime = Branded<string, 'IsoDateTime'>;

const ISO_DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Type guard: la stringa è una giornata YYYY-MM-DD ben formata. */
export function isIsoDate(v: string): v is IsoDate {
  return ISO_DATE_PATTERN.test(v);
}

/**
 * Brandizza una stringa YYYY-MM-DD. Un formato errato è un bug di programmazione
 * (i confini esterni devono validare prima con `isIsoDate`), quindi lancia RangeError.
 */
export function isoDate(v: string): IsoDate {
  if (!isIsoDate(v)) {
    throw new RangeError(`Giornata operativa non valida: "${v}" (atteso YYYY-MM-DD).`);
  }
  return v;
}

/** Converte una Date in IsoDateTime (UTC). */
export function isoDateTime(d: Date): IsoDateTime {
  return d.toISOString() as IsoDateTime;
}

/** Type guard: la stringa è un istante ISO 8601 interpretabile da `Date`. */
export function isIsoDateTime(v: string): v is IsoDateTime {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
    return false;
  }
  return !Number.isNaN(new Date(v).getTime());
}

/** Normalizza una stringa ISO qualsiasi in IsoDateTime UTC; `null` se non interpretabile. */
export function toIsoDateTime(v: string): IsoDateTime | null {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : isoDateTime(d);
}
