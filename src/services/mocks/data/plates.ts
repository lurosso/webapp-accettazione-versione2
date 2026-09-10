// Generatore di targhe italiane AA123BB (lettere ammesse: senza I, O, Q, U).

import type { PlateNumber } from '@/domain/value-objects/plate';
import type { SeededRandom } from './seeded-random';

/** Alfabeto delle targhe italiane. */
const PLATE_LETTERS = 'ABCDEFGHJKLMNPRSTVWXYZ';
const DIGITS = '0123456789';

/** Genera una targa italiana plausibile e già normalizzata. */
export function generateItalianPlate(rng: SeededRandom): PlateNumber {
  const plate = `${rng.string(PLATE_LETTERS, 2)}${rng.string(DIGITS, 3)}${rng.string(PLATE_LETTERS, 2)}`;
  return plate as PlateNumber;
}

/** Genera un VIN a 17 caratteri (senza I, O, Q come da standard). */
export function generateVin(rng: SeededRandom): string {
  return rng.string('ABCDEFGHJKLMNPRSTUVWXYZ0123456789', 17);
}
