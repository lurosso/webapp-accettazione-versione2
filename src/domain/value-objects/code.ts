// Normalizzazione dei codici di riferimento (brand, sportello, campata) usata in modo
// identico da mapper, repository e mock: "Alfa Romeo" → "ALFA_ROMEO", " s1 " → "S1".

/**
 * Normalizza un codice di riferimento: trim, maiuscolo, spazi e trattini → underscore.
 * È l'unica regola con cui si confrontano i codici provenienti dall'esterno.
 */
export function normalizeReferenceCode(code: string): string {
  return code.trim().toUpperCase().replace(/[\s-]+/g, '_');
}

/** Confronto di due codici di riferimento dopo normalizzazione. */
export function sameReferenceCode(a: string, b: string): boolean {
  return normalizeReferenceCode(a) === normalizeReferenceCode(b);
}
