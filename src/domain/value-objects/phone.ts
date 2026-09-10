// Telefono in formato E.164 (+39...). L'ultima cifra pilota gli esiti dei mock
// di Spoki e SMS Hosting (vedi services/mocks/data/phones.ts).

import type { Branded } from '../ids';
import type { DomainError } from '../errors';
import { domainError } from '../errors';
import type { Result } from '../result';
import { err, ok } from '../result';

/** Numero di telefono validato in formato E.164 (es. +393401234567). */
export type PhoneE164 = Branded<string, 'PhoneE164'>;

/** E.164: "+" seguito da 7-15 cifre, la prima diversa da zero. */
const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

/**
 * Normalizza e valida un numero: rimuove spazi, punti, trattini e parentesi,
 * converte il prefisso internazionale "00" in "+" e aggiunge il prefisso
 * predefinito (+39) se il numero è in formato nazionale.
 */
export function parsePhoneE164(
  raw: string,
  defaultCountry = '+39',
): Result<PhoneE164, DomainError> {
  let cleaned = raw.replace(/[\s.\-()]/g, '');
  if (cleaned.length === 0) {
    return err(domainError('VALIDATION', 'Il numero di telefono è vuoto.'));
  }
  if (cleaned.startsWith('00')) {
    cleaned = `+${cleaned.slice(2)}`;
  }
  if (!cleaned.startsWith('+')) {
    cleaned = `${defaultCountry}${cleaned}`;
  }
  if (!E164_PATTERN.test(cleaned)) {
    return err(
      domainError('VALIDATION', `Numero di telefono non valido: "${raw}".`, {
        normalized: cleaned,
      }),
    );
  }
  return ok(cleaned as PhoneE164);
}

/** Ultima cifra del numero (regola di simulazione guasti dei mock). */
export function lastDigit(phone: PhoneE164): string {
  return phone.slice(-1);
}

/** Ultime `n` cifre del numero (es. per la regola "99" o per identificare il cliente). */
export function lastDigits(phone: PhoneE164, n: number): string {
  return n <= 0 ? '' : phone.slice(-n);
}

/** Maschera il numero per i log: +39•••••••567. */
export function maskPhone(phone: PhoneE164): string {
  const visible = 3;
  const head = phone.slice(0, 3);
  const tail = phone.slice(-visible);
  const hidden = '•'.repeat(Math.max(0, phone.length - head.length - visible));
  return `${head}${hidden}${tail}`;
}
