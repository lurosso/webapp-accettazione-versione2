// Concatenazione di classi CSS condizionali (sostituisce clsx/tailwind-merge: nessuna dipendenza).
export type ClassValue = string | false | null | undefined;

/** Unisce le classi "vere" con uno spazio, ignorando false/null/undefined. */
export function cn(...values: readonly ClassValue[]): string {
  return values.filter((v): v is string => typeof v === 'string' && v.length > 0).join(' ');
}
