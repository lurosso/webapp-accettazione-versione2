// Date nel fuso Europe/Rome tramite Intl, senza dipendenze esterne.
// Gestisce l'ora legale calcolando l'offset effettivo del fuso per ogni istante.

import type { IsoDate, IsoDateTime } from '@/domain/value-objects/iso-date';
import { isoDate, isoDateTime } from '@/domain/value-objects/iso-date';

/** Fuso orario predefinito dell'officina. */
const DEFAULT_TIME_ZONE = 'Europe/Rome';

interface WallClockParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached !== undefined) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

/** Scompone un istante nelle componenti dell'orologio a muro del fuso indicato. */
function wallClockParts(d: Date, timeZone: string): WallClockParts {
  const parts = getFormatter(timeZone).formatToParts(d);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    return part === undefined ? 0 : Number.parseInt(part.value, 10);
  };
  // Alcuni motori restituiscono "24" per la mezzanotte: normalizziamo a 0.
  const hour = read('hour') % 24;
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour,
    minute: read('minute'),
    second: read('second'),
  };
}

/** Offset del fuso in millisecondi (ora locale − UTC) per l'istante indicato. */
function timeZoneOffsetMs(d: Date, timeZone: string): number {
  const p = wallClockParts(d, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Rimuoviamo i millisecondi dell'istante per confrontare a parità di precisione.
  const truncated = d.getTime() - (d.getTime() % 1000);
  return asUtc - truncated;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Giornata operativa (YYYY-MM-DD) dell'istante nel fuso indicato. */
export function toBusinessDate(d: Date, timeZone = DEFAULT_TIME_ZONE): IsoDate {
  const p = wallClockParts(d, timeZone);
  return isoDate(`${p.year}-${pad2(p.month)}-${pad2(p.day)}`);
}

/** Ora locale "HH:mm" dell'istante nel fuso indicato. */
export function localTimeHHmm(d: Date, timeZone = DEFAULT_TIME_ZONE): string {
  const p = wallClockParts(d, timeZone);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/**
 * Costruisce l'istante UTC corrispondente a "giornata + HH:mm" nel fuso indicato.
 * L'offset viene calcolato con Intl e ricontrollato per gestire i cambi di ora legale.
 */
export function buildLocalDateTime(
  businessDate: IsoDate,
  hhmm: string,
  timeZone = DEFAULT_TIME_ZONE,
): IsoDateTime {
  const [yearStr, monthStr, dayStr] = businessDate.split('-');
  const [hourStr, minuteStr] = hhmm.split(':');
  const year = Number.parseInt(yearStr ?? '1970', 10);
  const month = Number.parseInt(monthStr ?? '01', 10);
  const day = Number.parseInt(dayStr ?? '01', 10);
  const hour = Number.parseInt(hourStr ?? '00', 10);
  const minute = Number.parseInt(minuteStr ?? '00', 10);

  // Prima stima: interpretiamo l'orario locale come se fosse UTC.
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstOffset = timeZoneOffsetMs(new Date(guess), timeZone);
  let utc = guess - firstOffset;
  // Seconda passata: se l'offset cambia (transizione DST) usiamo quello corretto.
  const secondOffset = timeZoneOffsetMs(new Date(utc), timeZone);
  if (secondOffset !== firstOffset) {
    utc = guess - secondOffset;
  }
  return isoDateTime(new Date(utc));
}

/** Somma minuti a un istante ISO. */
export function addMinutes(iso: IsoDateTime, minutes: number): IsoDateTime {
  return isoDateTime(new Date(new Date(iso).getTime() + minutes * 60_000));
}

/**
 * Formatta un istante ISO per la UI in italiano nel fuso indicato (es. "10/09/2026, 08:12:33").
 * Solo per la presentazione: i dati restano sempre ISO 8601 UTC.
 */
export function formatDateTimeIt(iso: IsoDateTime, timeZone = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat('it-IT', {
    timeZone,
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(iso));
}

/** Confronto lessicografico di due istanti ISO UTC (negativo se `a` precede `b`). */
export function compareIso(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

/** Differenza in millisecondi `b − a` fra due istanti ISO. */
export function diffMs(a: IsoDateTime, b: IsoDateTime): number {
  return new Date(b).getTime() - new Date(a).getTime();
}
