'use client';

// Navigazione con la transizione di pagina: prima si dice al contenitore della pagina corrente di
// sfumare (feedback immediato al tocco), poi si chiede la pagina nuova al router. Non si aspetta
// niente: la richiesta parte subito, l'uscita si sovrappone all'attesa del server. Verso la stessa
// pagina (cambia solo la query) non si sfuma: il contenitore non si rimonta e non ci sarebbe
// nessuna entrata a riportarlo visibile.
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { segnalaUscita, soloPercorso } from '@/components/layout/page-transition-store';

export interface TransitionRouter {
  /** Come `router.push`, ma la pagina corrente sfuma mentre arriva la nuova. */
  readonly push: (href: string) => void;
}

export function useTransitionRouter(): TransitionRouter {
  const router = useRouter();
  const pathname = usePathname();
  const push = useCallback(
    (href: string): void => {
      if (pathname !== null && soloPercorso(href) !== pathname) {
        segnalaUscita(pathname);
      }
      router.push(href);
    },
    [router, pathname],
  );
  return useMemo(() => ({ push }), [push]);
}
