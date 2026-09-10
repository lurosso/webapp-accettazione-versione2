// Utilità pure per l'input targa del portale (testabili senza React).
import { normalizePlate, parsePlate } from '@/domain/value-objects/plate';

/** Lunghezza massima accettata dal campo (targhe UE fino a 9 caratteri). */
export const PLATE_MAX_LENGTH = 9;

/**
 * Formattazione mentre il cliente digita: maiuscolo, niente spazi, trattini o punti,
 * solo lettere e cifre, lunghezza limitata. Non valida: serve a non far sbagliare.
 */
export function formatPlateInput(raw: string): string {
  return normalizePlate(raw)
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, PLATE_MAX_LENGTH);
}

/** Messaggio d'errore per la targa digitata, oppure null se è utilizzabile. */
export function plateErrorMessage(raw: string): string | null {
  const formatted = formatPlateInput(raw);
  if (formatted === '') {
    return 'Inserisci la targa del veicolo.';
  }
  const parsed = parsePlate(formatted);
  return parsed.ok ? null : 'Targa non valida: controlla di averla digitata correttamente.';
}
