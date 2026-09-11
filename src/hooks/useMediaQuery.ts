'use client';

// Rilevamento della larghezza dello schermo per il "responsive workflow": la stessa applicazione
// si comporta in modo diverso a seconda che l'accettatore sia seduto al banco o in piedi sul
// piazzale con il tablet in mano.
//
// Il valore parte da `false` e viene calcolato dopo il montaggio: il server non conosce la
// larghezza del dispositivo e un'ipotesi sbagliata farebbe lampeggiare la pagina al primo render
// (disallineamento di idratazione). Fino a quel momento vale il comportamento da scrivania, che è
// quello che non porta l'operatore altrove senza che l'abbia chiesto.
import { useEffect, useState } from 'react';

/**
 * Soglia del flusso touch. 1024 px comprende i tablet in orizzontale (iPad 10" e Android 10-11")
 * ed esclude i monitor delle postazioni; è la stessa misura usata dal committente per dire
 * "tablet sul piazzale".
 */
export const TOUCH_LAYOUT_MAX_WIDTH = 1024;

/** True quando la media query è soddisfatta; si aggiorna ruotando il tablet o ridimensionando. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const mql = window.matchMedia(query);
    const update = (): void => setMatches(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [query]);

  return matches;
}

/** True su tablet e telefoni (larghezza ≤ 1024 px): decide il flusso dopo "Prendi in carico". */
export function useIsTouchLayout(): boolean {
  return useMediaQuery(`(max-width: ${TOUCH_LAYOUT_MAX_WIDTH}px)`);
}
