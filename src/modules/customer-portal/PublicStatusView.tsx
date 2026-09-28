'use client';

// Vista di stato del portale cliente: polling ogni 5 s verso l'API pubblica, con la scheda dello
// stato e i due pulsanti, oppure il messaggio di errore. Mantiene sempre visibile l'ultimo stato
// noto: se la rete cade, il cliente continua a vedere il proprio codice.
import Link from 'next/link';
import { problemFrom, usePublicStatus } from '@/hooks/usePublicStatus';
import { ConcludedCard } from './ConcludedCard';
import { ArrivalButton } from './ArrivalButton';
import { LateNoticeButton } from './LateNoticeButton';
import { PortalStatusCard } from './PortalStatusCard';
import { ServiceUnavailableCard } from './ServiceUnavailableCard';

export interface PublicStatusViewProps {
  readonly targa: string;
  /** Token unico della pratica dal link WhatsApp (`?t=`); null dal QR. */
  readonly token?: string | null;
}

export function PublicStatusView({ targa, token = null }: PublicStatusViewProps) {
  const query = usePublicStatus(targa, token);

  if (query.isPending) {
    return (
      <section className="border-line bg-surface flex flex-col items-center gap-3 rounded-3xl border-2 p-8 text-center shadow-sm">
        <p className="text-ink-soft text-xl">
          {targa !== '' ? `Cerchiamo la targa ${targa}…` : 'Un istante…'}
        </p>
      </section>
    );
  }

  // Un errore definitivo (targa non più in agenda, targa non valida, troppe richieste) va sempre
  // mostrato: continuare a esporre l'ultimo stato noto ingannerebbe il cliente, che resterebbe in
  // attesa di una chiamata mai prevista. Solo un guasto di rete o del server conserva lo stato
  // precedente, perché lì il dato è ancora verosimile.
  const problem = query.isError ? problemFrom(query.error) : null;
  if (problem !== null && (query.data === undefined || problem !== 'unavailable')) {
    return <ServiceUnavailableCard problem={problem} plate={targa} />;
  }
  if (query.data === undefined) {
    return <ServiceUnavailableCard problem="unavailable" plate={targa} />;
  }

  const { position, timeZone } = query.data;
  if (position.expired) {
    return <ConcludedCard position={position} />;
  }

  return (
    <div className="flex flex-col gap-5">
      <PortalStatusCard
        position={position}
        stale={query.isError}
        action={
          <div className="flex w-full flex-col gap-3">
            {/* Prima «Sono qui» (il gesto che ci si aspetta appena entrati in officina), poi il
                ritardo, che serve a chi invece non è ancora qui. */}
            <ArrivalButton position={position} targa={targa} token={token} timeZone={timeZone} />
            <LateNoticeButton position={position} targa={targa} token={token} timeZone={timeZone} />
          </div>
        }
      />
      {/* Chi è entrato con la targa può averla scritta male: gli si lascia la strada per
          riprovare. Dal link WhatsApp la pratica è già la sua, e il collegamento sarebbe solo
          una cosa in più da leggere. */}
      {targa !== '' ? (
        <Link
          href="/cliente"
          className="controllo focus-anello text-ink-soft hover:text-ink mx-auto inline-flex items-center rounded-md px-4 text-lg font-medium underline"
        >
          Cerca un&apos;altra targa
        </Link>
      ) : null}
      <p className="text-ink-muted text-center text-lg">Questa pagina si aggiorna da sola.</p>
    </div>
  );
}
