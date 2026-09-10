// Targa veicolo: value object normalizzato (maiuscolo, senza spazi né trattini),
// chiave di ricerca del portale cliente.

import type { Branded } from '../ids';
import type { DomainError } from '../errors';
import { domainError } from '../errors';
import type { Result } from '../result';
import { err, ok } from '../result';

/** Targa normalizzata e validata. */
export type PlateNumber = Branded<string, 'PlateNumber'>;

/** Formato italiano corrente: due lettere, tre cifre, due lettere (es. AB123CD). */
const IT_PLATE_PATTERN = /^[A-Z]{2}\d{3}[A-Z]{2}$/;
/** Formati UE generici: da 4 a 9 caratteri alfanumerici. */
const EU_PLATE_PATTERN = /^[A-Z0-9]{4,9}$/;

/** Normalizza la targa: maiuscolo, rimozione di spazi, trattini e punti. */
export function normalizePlate(raw: string): string {
  return raw.toUpperCase().replace(/[\s\-.]/g, '');
}

/**
 * Valida e brandizza una targa. Accetta il formato italiano AA123BB e,
 * in fallback, formati UE alfanumerici (4-9 caratteri).
 */
export function parsePlate(raw: string): Result<PlateNumber, DomainError> {
  const normalized = normalizePlate(raw);
  if (normalized.length === 0) {
    return err(domainError('VALIDATION', 'La targa è obbligatoria.'));
  }
  if (IT_PLATE_PATTERN.test(normalized) || EU_PLATE_PATTERN.test(normalized)) {
    return ok(normalized as PlateNumber);
  }
  return err(
    domainError('VALIDATION', `Targa non valida: "${raw}".`, { normalized }),
  );
}

/** Indica se la targa rispetta il formato italiano corrente. */
export function isItalianPlate(plate: PlateNumber): boolean {
  return IT_PLATE_PATTERN.test(plate);
}
