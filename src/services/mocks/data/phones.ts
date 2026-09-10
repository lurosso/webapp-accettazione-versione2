// Telefoni cellulari italiani (+39 3xx xxxxxxx) con ultima cifra pilotabile:
// la cifra finale decide l'esito dei mock di Spoki e SMS Hosting.
// La regola vive in services/interfaces/mock-config.ts (unica fonte, condivisa con env.ts).

import type { PhoneE164 } from '@/domain/value-objects/phone';
import { MOCK_PHONE_RULES } from '../../interfaces/mock-config';
import type { SeededRandom } from './seeded-random';

/** Regole "ultima cifra del telefono" (alias di MOCK_PHONE_RULES per i mock). */
export const PHONE_OUTCOME_RULES = MOCK_PHONE_RULES;

/** Suffissi che esercitano i fallback, usati dall'agenda finta (~5% dei clienti). */
export const FAILURE_SUFFIXES: readonly string[] = [
  MOCK_PHONE_RULES.whatsappUndeliverable,
  MOCK_PHONE_RULES.timeout,
  MOCK_PHONE_RULES.whatsappInvalid,
  MOCK_PHONE_RULES.bothChannelsFail,
];

/**
 * Genera un cellulare +39 3xx xxxxxxx (10 cifre dopo il prefisso).
 * Con `forcedSuffix` le ultime cifre vengono sostituite (es. "99").
 */
export function generateItalianMobile(rng: SeededRandom, forcedSuffix?: string): PhoneE164 {
  let national = `3${rng.string('0123456789', 9)}`;
  if (forcedSuffix !== undefined && forcedSuffix.length > 0 && forcedSuffix.length < national.length) {
    national = `${national.slice(0, national.length - forcedSuffix.length)}${forcedSuffix}`;
  }
  return `+39${national}` as PhoneE164;
}
