// Confronto di segreti senza fughe di tempo.
//
// Un confronto con `===` si ferma al primo carattere diverso: misurando i tempi di risposta si
// può indovinare un segreto un carattere alla volta. Sull'intestazione del cron esterno e su
// qualunque token che passi in chiaro si confronta sempre a tempo costante.
import { timingSafeEqual } from 'node:crypto';

/** True se i due valori coincidono; il tempo impiegato non dipende da dove differiscono. */
export function secretsMatch(fornito: string | null | undefined, atteso: string | null): boolean {
  if (fornito === null || fornito === undefined || atteso === null || atteso === '') {
    return false;
  }
  const a = Buffer.from(fornito, 'utf8');
  const b = Buffer.from(atteso, 'utf8');
  // Lunghezze diverse: si confronta comunque qualcosa della stessa lunghezza, così anche questo
  // caso non risponde più in fretta degli altri.
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}
