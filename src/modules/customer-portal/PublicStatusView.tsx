'use client';

// Vista di stato del portale cliente: polling ogni 5 s verso l'API pubblica, con la card dello
// stato oppure il messaggio di errore. Mantiene sempre visibile l'ultimo stato noto: se la rete
// cade, il cliente continua a vedere il proprio codice.
import Link from 'next/link';
import { problemFrom, usePublicStatus } from '@/hooks/usePublicStatus';
import { QueuePositionCard } from './QueuePositionCard';
import { ServiceUnavailableCard } from './ServiceUnavailableCard';

export interface PublicStatusViewProps {
  readonly targa: string;
}

export function PublicStatusView({ targa }: PublicStatusViewProps) {
  const query = usePublicStatus(targa);

  if (query.isPending) {
    return (
      <section className="flex flex-col items-center gap-3 rounded-2xl border-2 border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-lg text-slate-600">Cerchiamo la targa {targa}…</p>
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

  return (
    <div className="flex flex-col gap-4">
      <QueuePositionCard
        position={query.data.position}
        timeZone={query.data.timeZone}
        updatedAtMs={query.dataUpdatedAt}
        stale={query.isError}
      />
      <Link
        href="/cliente"
        className="mx-auto text-base font-medium text-slate-600 underline hover:text-slate-900"
      >
        Cerca un&apos;altra targa
      </Link>
      {/* Promessa fatta solo dove è vera: sulle schermate di errore non c'è nulla da aggiornare. */}
      <p className="text-center text-sm text-slate-500">
        Questa pagina si aggiorna da sola: tienila aperta mentre attendi.
      </p>
    </div>
  );
}
