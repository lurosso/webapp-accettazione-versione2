// Hash deterministico di stringhe (FNV-1a a 32 bit) per seminare i PRNG dei mock.

/** FNV-1a 32 bit: restituisce un intero senza segno in [0, 2^32). */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // Moltiplicazione per il primo FNV (16777619) in aritmetica a 32 bit senza overflow.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
