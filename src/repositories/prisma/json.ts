// Gli oggetti annidati del dominio viaggiano in colonne di testo JSON (SQLite non ha un tipo JSON
// e nessuna di queste strutture si interroga per campo). Qui il giro di andata e ritorno, in un
// posto solo: se un domani una colonna contiene qualcosa di illeggibile, l'errore dice quale.
import { domainError } from '@/domain/errors';

export function toJson(value: unknown): string {
  return JSON.stringify(value);
}

/** Legge una colonna JSON; un contenuto corrotto è un errore interno con la colonna nel messaggio. */
export function fromJson<T>(text: string, colonna: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    const e = domainError('INTERNAL', `Colonna ${colonna} illeggibile: non è JSON valido.`);
    throw new Error(e.message);
  }
}
