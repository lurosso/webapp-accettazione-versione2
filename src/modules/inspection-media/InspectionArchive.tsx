'use client';

// Archivio delle ispezioni: lo storico dei check-in fotografici, ricercabile per targa o codice.
// Serve al ritiro, quando un cliente contesta un danno: si cerca la targa e si vede cosa era
// stato fotografato all'arrivo. Le foto oltre la retention non hanno più il file, ma la scheda
// resta e dice che il giro era stato fatto e quando.
import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InspectionArchiveEntry } from '@/application/media/InspectionArchiveService';
import { Badge } from '@/components/ui/badge';
import { Notice } from '@/components/ui/notice';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { fetchInspectionArchive, patchAppointmentRetention } from '@/lib/api-client/client';
import { formatDateTimeIt, localTimeHHmm } from '@/lib/dates';
import { archiveCountLabel, filterArchiveEntries } from './archive-filter';
import {
  RiquadroConservazione,
  type ComandiConservazione,
} from '@/modules/reception/RetentionControls';

export interface InspectionArchiveProps {
  readonly timeZone: string;
  readonly retentionDays: number;
  /** Amministratore: sulle schede compaiono i comandi di conservazione (vincolo, commessa). */
  readonly canEditRetention?: boolean;
  /** La giornata operativa del server (YYYY-MM-DD): è quella che l'archivio apre per prima. */
  readonly today: string;
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
  retention,
}: {
  readonly entry: InspectionArchiveEntry;
  readonly timeZone: string;
  readonly retention: ComandiConservazione;
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

      {/*
       * Perché queste foto ci sono ancora — e, per l'amministratore, i comandi per deciderlo. È in
       * archivio che si cerca la targa di tre mesi fa quando arriva una contestazione: il vincolo
       * legale si mette qui, non nella coda di oggi. Il PATCH lavora per id di pratica e il
       * repository cerca su tutte le giornate: una pratica passata si tratta come una di oggi.
       */}
      <div className="mt-3">
        <RiquadroConservazione a={entry} timeZone={timeZone} retention={retention} />
      </div>
    </li>
  );
}

export function InspectionArchive({
  timeZone,
  retentionDays,
  canEditRetention = false,
  today,
}: InspectionArchiveProps) {
  const queryClient = useQueryClient();
  const [testo, setTesto] = useState('');
  const [query, setQuery] = useState('');
  // Il giorno che si sta guardando. Si apre su oggi — al ritiro serve com'era il veicolo
  // all'arrivo, e l'arrivo è oggi — e il calendario porta indietro. Con una ricerca per targa o
  // codice il giorno non conta: la storia di un veicolo attraversa le giornate.
  const [giorno, setGiorno] = useState(today);
  // «Solo con foto/video»: al ritiro interessano le pratiche documentate, non tutta l'agenda.
  // Spento per default: l'archivio resta l'elenco completo della giornata.
  const [soloConMedia, setSoloConMedia] = useState(false);

  /** I comandi di conservazione per una scheda: dopo il cambio si ricarica l'archivio. */
  const comandiPer = (entry: InspectionArchiveEntry): ComandiConservazione =>
    canEditRetention
      ? {
          onChange: async (patch) => {
            await patchAppointmentRetention(entry.appointmentId, patch);
            await queryClient.invalidateQueries({ queryKey: ['inspection-archive'] });
          },
        }
      : undefined;
  const risultati = useQuery({
    queryKey: ['inspection-archive', query, giorno] as const,
    queryFn: () => fetchInspectionArchive(query === '' ? { date: giorno } : { query }),
    placeholderData: keepPreviousData,
  });
  const giornoLeggibile = new Intl.DateTimeFormat('it-IT', { dateStyle: 'full' }).format(
    new Date(`${giorno}T12:00:00Z`),
  );
  const tutte = risultati.data?.entries ?? [];
  const voci = filterArchiveEntries(tutte, soloConMedia);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Archivio ispezioni</h1>
        <p className="text-sm text-slate-600">
          Si apre sulle pratiche di oggi; il calendario porta a un giorno passato. Cercando una
          targa o un codice: tutti gli ingressi storici di quel veicolo, su tutte le giornate, dal
          più recente. I file restano almeno {retentionDays} giorni, e vengono eliminati solo quando
          la commessa è chiusa e non c&apos;è un vincolo legale: la scheda rimane.
        </p>
      </header>

      {/*
       * La barra degli strumenti è un riquadro proprio sotto il titolo, in due righe: calendario e
       * ricerca sulla prima, l'interruttore sulla seconda. Ogni controllo ha la stessa altezza
       * (`controllo`) e una larghezza minima; quando lo spazio manca la ricerca va a capo intera,
       * mai sopra il calendario. Niente posizionamenti assoluti: solo flex con `gap`.
       */}
      <section
        className="bg-surface border-line flex flex-col gap-4 rounded-2xl border p-4"
        role="search"
        aria-label="Strumenti dell'archivio"
        data-testid="archivio-strumenti"
      >
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex w-52 shrink-0 flex-col gap-1.5">
            <span className="testo-nota text-ink-soft font-semibold">Giornata</span>
            {/*
             * Il campo data sta in una CORNICE alta quanto ogni altro controllo. Su iOS Safari
             * l'<input type="date"> ignora l'altezza che gli si dà e si disegna basso quanto il suo
             * valore: accanto alla ricerca sembrava schiacciato. Qui l'altezza la fa la cornice
             * (stessi bordo, sfondo e padding di `Input`) e il campo, trasparente, ci sta dentro
             * centrato; l'anello di focus lo prende la cornice.
             */}
            <span
              className="controllo border-line bg-surface focus-anello-dentro transizione flex w-full min-w-44 items-center rounded-md border px-3.5 shadow-xs"
              data-testid="archivio-giorno-cornice"
            >
              <input
                type="date"
                value={giorno}
                max={today}
                aria-label="Giornata da consultare"
                data-testid="archivio-giorno"
                onChange={(event) => {
                  if (event.target.value !== '') {
                    setGiorno(event.target.value);
                    setQuery('');
                    setTesto('');
                  }
                }}
                className="testo-corpo text-ink h-full w-full min-w-0 bg-transparent outline-none"
              />
            </span>
          </label>
          <form
            className="flex min-w-[20rem] flex-1 flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              setQuery(testo.trim());
            }}
          >
            <label className="flex min-w-[14rem] flex-1 flex-col gap-1.5">
              <span className="testo-nota text-ink-soft font-semibold">Targa o codice</span>
              <Input
                aria-label="Cerca per targa o codice pratica"
                placeholder="es. AB123CD, F012"
                value={testo}
                onChange={(event) => setTesto(event.target.value)}
                className="controllo font-mono uppercase"
              />
            </label>
            <button
              type="submit"
              className="bg-brand-secondary hover:bg-brand-blue-dark premibile focus-anello controllo min-w-touch inline-flex shrink-0 items-center justify-center rounded-md px-4 text-sm font-semibold text-white"
            >
              Cerca
            </button>
          </form>
        </div>
        <Switch
          checked={soloConMedia}
          onChange={setSoloConMedia}
          label="Solo con foto/video"
          description="Nasconde le pratiche senza file allegati"
          testId="archivio-solo-media"
        />
      </section>

      <p className="testo-corpo text-ink-soft" data-testid="archivio-intestazione">
        {query === ''
          ? giorno === today
            ? `Oggi, ${giornoLeggibile}`
            : giornoLeggibile
          : `Risultati per «${query}» su tutte le giornate`}
        {risultati.data !== undefined ? (
          <span className="text-ink-muted" data-testid="archivio-conteggio">
            {' · '}
            {archiveCountLabel(voci.length, tutte.length, soloConMedia)}
          </span>
        ) : null}
      </p>

      {risultati.isPending ? (
        <TableSkeleton rows={3} columns={4} label="Caricamento dell'archivio" />
      ) : risultati.isError ? (
        <Notice tone="error">
          Archivio non disponibile in questo momento: riprova fra qualche istante.
        </Notice>
      ) : voci.length === 0 ? (
        <EmptyState
          size="page"
          title={
            soloConMedia && tutte.length > 0
              ? 'Nessuna pratica con foto o video'
              : query === ''
                ? 'Nessuna pratica in questa giornata'
                : `Nessun risultato per "${query}"`
          }
          description={
            soloConMedia && tutte.length > 0
              ? `Le ${tutte.length} pratiche trovate non hanno file allegati: spegni «Solo con foto/video» per vederle.`
              : query === ''
                ? 'Nessun ingresso in agenda per il giorno scelto: prova un altro giorno dal calendario.'
                : 'Controlla la targa (senza spazi) o il codice pratica.'
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {voci.map((entry) => (
            <Scheda
              key={entry.appointmentId}
              entry={entry}
              timeZone={timeZone}
              retention={comandiPer(entry)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
