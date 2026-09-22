'use client';

// La transizione fra una pagina e l'altra, disegnata dal contenitore legato al percorso.
//
// Tre fasi, scritte in un attributo (`data-fase`) e animate da CSS in `globals.css`:
// - `uscita`: la pagina che si sta lasciando sfuma appena si tocca il link (feedback immediato,
//   mentre la nuova viene chiesta al server);
// - `entrata`: la pagina nuova è nel DOM ma ancora trasparente;
// - `visibile`: la transizione verso opacità piena, avviata DOPO che il browser ha dipinto lo
//   stato iniziale.
//
// Perché non una semplice animazione CSS all'inserimento: sull'iPad la nuova pagina arriva dal
// server e va idratata — decine di schede, query, immagini — e il thread principale resta occupato
// per centinaia di millisecondi fra l'inserimento del contenitore e il primo frame dipinto. Una
// `animation` di 200 ms parte all'inserimento e, quando il primo frame arriva, è già finita: la
// pagina compare di colpo al suo stato finale. Chrome sul PC idrata in pochi millisecondi e la
// mostra; WebKit sul tablet no. Qui invece il contenitore viene dipinto trasparente, e solo al
// frame successivo (`requestAnimationFrame` due volte) parte la transizione: qualunque sia il
// tempo di idratazione, la dissolvenza si vede.
//
// La prima pagina della sessione non fa l'entrata: il server la manda già visibile e resta tale
// anche prima che il JavaScript arrivi. L'animazione vale per le navigazioni fatte a mano.
import { usePathname } from 'next/navigation';
import { useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  azzeraUscita,
  iscrivitiAllaTransizione,
  percorsoInUscitaCorrente,
  percorsoInUscitaServer,
  primaPaginaGiaMontata,
  segnaPrimaPaginaMontata,
} from './page-transition-store';

type Fase = 'entrata' | 'visibile';

/** Se i frame non arrivano entro questo tempo, la pagina si mostra comunque. */
const RETE_DI_SICUREZZA_MS = 150;

export function PageTransition({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname() ?? '/';
  // La `key` sul percorso smonta e rimonta il contenitore a ogni navigazione: senza, fra pagine
  // dello stesso gruppo (coda → archivio) resterebbe montato e non ci sarebbe niente da animare.
  return (
    <Pagina key={pathname} pathname={pathname}>
      {children}
    </Pagina>
  );
}

function Pagina({
  pathname,
  children,
}: {
  readonly pathname: string;
  readonly children: ReactNode;
}) {
  const [fase, setFase] = useState<Fase>(() => (primaPaginaGiaMontata() ? 'entrata' : 'visibile'));
  const inUscita = useSyncExternalStore(
    iscrivitiAllaTransizione,
    percorsoInUscitaCorrente,
    percorsoInUscitaServer,
  );

  // Layout effect, non effetto passivo: parte al commit del DOM, prima del primo paint, così i due
  // frame (o il timer) si contano da quando il contenitore esiste davvero, non da quando React
  // trova il tempo di eseguire gli effetti dopo l'idratazione.
  useLayoutEffect(() => {
    segnaPrimaPaginaMontata();
    // La pagina nuova è qui: qualunque uscita segnalata dalla precedente è conclusa.
    azzeraUscita();
    if (fase === 'visibile') {
      return undefined;
    }
    // Primo frame: il browser dipinge il contenitore trasparente. Secondo frame: parte la
    // transizione. Un solo frame non basta a WebKit, che a volte fonde stile iniziale e finale.
    // Il timer è la rete di sicurezza: se i frame non arrivano (scheda in secondo piano, PWA
    // appena riportata in primo piano) la pagina non deve restare trasparente.
    let secondo = 0;
    const mostra = (): void => {
      cancelAnimationFrame(primo);
      cancelAnimationFrame(secondo);
      clearTimeout(timer);
      setFase('visibile');
    };
    const primo = requestAnimationFrame(() => {
      secondo = requestAnimationFrame(mostra);
    });
    const timer = setTimeout(mostra, RETE_DI_SICUREZZA_MS);
    return () => {
      cancelAnimationFrame(primo);
      cancelAnimationFrame(secondo);
      clearTimeout(timer);
    };
  }, [fase]);

  // Solo la pagina che si sta lasciando sfuma: la nuova legge lo store ma non è lei.
  const faseVisibile = inUscita === pathname ? 'uscita' : fase;

  return (
    <div className="transizione-pagina" data-fase={faseVisibile} data-testid="transizione-pagina">
      {children}
    </div>
  );
}
