'use client';

// Rilevamento del tipo di dispositivo per la separazione PC / tablet: la stessa applicazione si
// comporta in modo diverso a seconda che l'accettatore sia seduto al banco con il mouse o in piedi
// sul piazzale con il tablet in mano.
//
// Il criterio è il puntatore principale, non la larghezza dello schermo: un iPad in orizzontale è
// più largo di molti monitor, ma si usa con le dita. `(pointer: coarse)` è vero su tablet e
// telefoni e falso su un PC con il mouse, anche se la finestra è stretta.
//
// Il valore parte da `false` e viene calcolato dopo il montaggio: il server non conosce il
// dispositivo e un'ipotesi sbagliata farebbe lampeggiare la pagina al primo render. Fino a quel
// momento vale il comportamento da scrivania, che è quello che non porta l'operatore altrove.
import { useEffect, useState } from 'react';

/** Media query del flusso touch: dispositivi il cui puntatore principale è il dito. */
export const TOUCH_LAYOUT_QUERY = '(pointer: coarse)';

/** True quando la media query è soddisfatta; si aggiorna se il dispositivo cambia modalità. */
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

/** True su tablet e telefoni: decide il flusso dopo "Prendi in carico" e la presentazione del dettaglio. */
export function useIsTouchLayout(): boolean {
  return useMediaQuery(TOUCH_LAYOUT_QUERY);
}

export type TouchLayoutKind = 'unknown' | 'touch' | 'desktop';

/**
 * Come `useIsTouchLayout`, ma distingue "non ancora misurato" da "PC": serve alle pagine che sul
 * PC non devono comparire affatto (il check-in fotografico), per non mostrarle un istante prima
 * di sostituirle con l'avviso.
 */
export function useTouchLayoutKind(): TouchLayoutKind {
  const [kind, setKind] = useState<TouchLayoutKind>('unknown');

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const mql = window.matchMedia(TOUCH_LAYOUT_QUERY);
    const update = (): void => setKind(mql.matches ? 'touch' : 'desktop');
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  return kind;
}
