'use client';

// Archivio delle ispezioni: lo storico dei check-in fotografici, ricercabile per targa o codice.
// Serve al ritiro, quando un cliente contesta un danno: si cerca la targa e si vede cosa era
// stato fotografato all'arrivo. Le foto oltre la retention non hanno più il file, ma la scheda
// resta e dice che il giro era stato fatto e quando.
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { InspectionArchiveEntry } from '@/application/media/InspectionArchiveService';
import { Badge } from '@/components/ui/badge';
import { Notice } from '@/components/ui/notice';
import { Input } from '@/components/ui/input';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { fetchInspectionArchive } from '@/lib/api-client/client';
import { formatDateTimeIt, localTimeHHmm } from '@/lib/dates';

export interface InspectionArchiveProps {
  readonly timeZone: string;
  readonly retentionDays: number;
}

const STATO_IT: Record<string, string> = {
  WAITING: 'In attesa',
  IN_PROGRESS: 'In carico',
  COMPLETED: 'Completata',
  SKIPPED: 'Saltata',
  NO_SHOW: 'Assente',
  CANCELLED: 'Annullata',
};

function Scheda({
  entry,
  timeZone,
}: {
  readonly entry: InspectionArchiveEntry;
  readonly timeZone: string;
}) {
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="font-mono text-2xl font-black">{entry.code}</span>
          <span className="font-mono text-lg font-bold text-slate-700">{entry.plate}</span>
          <span className="text-sm text-slate-600">
            {entry.vehicle} · {entry.customerName}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
          <span>
            {entry.businessDate} · {localTimeHHmm(new Date(entry.scheduledAt), timeZone)}
          </span>
          {entry.flow === 'RETURN' ? <Badge tone="info">Riconsegna</Badge> : null}
          <Badge tone={entry.status === 'COMPLETED' ? 'success' : 'neutral'}>
            {STATO_IT[entry.status] ?? entry.status}
          </Badge>
          {entry.archived ? <Badge tone="neutral">File archiviati</Badge> : null}
        </div>
      </div>

      {/* Dettaglio dell'ingresso: commessa e lavorazioni, così la storia del veicolo si legge da qui. */}
      <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-slate-500">Commessa</dt>
        <dd className="font-mono text-slate-800">{entry.workOrderRef ?? '—'}</dd>
        <dt className="text-slate-500">Lavorazioni</dt>
        <dd className="text-slate-800">{entry.serviceDescription ?? '—'}</dd>
      </dl>

      {entry.notes !== null ? (
        <p className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-sm whitespace-pre-wrap text-slate-800">
          {entry.notes}
        </p>
      ) : null}

      <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {entry.photos.map((photo) => (
          <li key={photo.id} className="flex flex-col gap-1">
            <div className="relative aspect-square overflow-hidden rounded-md border border-slate-200 bg-slate-100">
              {photo.url === null ? (
                <div className="flex h-full w-full flex-col items-center justify-center px-1 text-center text-[10px] text-slate-500">
                  <span aria-hidden="true" className="text-xl">
                    🗄️
                  </span>
                  file eliminato
                  {photo.archivedAt !== null ? (
                    <span>il {formatDateTimeIt(photo.archivedAt, timeZone).slice(0, 8)}</span>
                  ) : null}
                </div>
              ) : photo.kind === 'VIDEO' ? (
                // Il video si guarda dall'archivio: al ritiro è la prova più chiara di com'era
                // il veicolo all'arrivo.
                <video
                  src={photo.url}
                  controls
                  preload="metadata"
                  playsInline
                  aria-label={`Video acquisito il ${entry.businessDate}`}
                  className="h-full w-full bg-black object-cover"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- file servito dalla rotta media
                <img
                  src={photo.url}
                  alt={photo.categoryLabel}
                  className="h-full w-full object-cover"
                />
              )}
            </div>
            <span className="text-[11px] leading-tight font-semibold text-slate-700">
              {photo.categoryLabel}
              <span className="block font-normal text-slate-500">
                {localTimeHHmm(new Date(photo.capturedAt), timeZone)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}

export function InspectionArchive({ timeZone, retentionDays }: InspectionArchiveProps) {
  const [testo, setTesto] = useState('');
  const [query, setQuery] = useState('');
  const risultati = useQuery({
    queryKey: ['inspection-archive', query] as const,
    queryFn: () => fetchInspectionArchive(query),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Archivio ispezioni</h1>
          <p className="text-sm text-slate-600">
            Senza ricerca: i check-in fotografici degli ultimi giorni. Cercando una targa: tutti gli
            ingressi storici di quel veicolo, dal più recente, con data, stato, commessa e foto se
            ci sono. I file restano {retentionDays} giorni, poi vengono eliminati: la scheda rimane.
          </p>
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setQuery(testo.trim());
          }}
        >
          <Input
            aria-label="Cerca per targa o codice pratica"
            placeholder="Targa o codice (es. AB123CD, F012)"
            value={testo}
            onChange={(event) => setTesto(event.target.value)}
            className="controllo w-64 font-mono uppercase"
          />
          <button
            type="submit"
            className="bg-brand-secondary hover:bg-brand-blue-dark premibile focus-anello controllo min-w-touch inline-flex items-center justify-center rounded-md px-4 text-sm font-semibold text-white"
          >
            Cerca
          </button>
        </form>
      </header>

      {risultati.isPending ? (
        <TableSkeleton rows={3} columns={4} label="Caricamento dell'archivio" />
      ) : risultati.isError ? (
        <Notice tone="error">
          Archivio non disponibile in questo momento: riprova fra qualche istante.
        </Notice>
      ) : (risultati.data?.entries.length ?? 0) === 0 ? (
        <EmptyState
          size="page"
          title={query === '' ? 'Nessun check-in fotografico' : `Nessun risultato per "${query}"`}
          description={
            query === ''
              ? 'Le ispezioni fatte dal tablet compaiono qui appena scattata la prima foto.'
              : 'Controlla la targa (senza spazi) o il codice pratica.'
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {risultati.data?.entries.map((entry) => (
            <Scheda key={entry.appointmentId} entry={entry} timeZone={timeZone} />
          ))}
        </ul>
      )}
    </div>
  );
}
