'use client';

// Galleria di foto e video acquisiti al tablet, mostrata nel pannello di dettaglio della dashboard.
// Serve a chi sta al banco: quando il cliente chiede "cosa avete visto sull'auto?", i media e le
// note dell'ispezione sono lì, senza dover cercare il tablet o chiamare il collega che l'ha fatta.
//
// I media arrivano dalla stessa rotta autenticata usata dal tablet. Se la richiesta fallisce la
// sezione lo dice e basta: il resto del pannello (telefono del cliente, cronologia) deve restare
// utilizzabile, perché è quello che serve per lavorare.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  PHOTO_CATEGORIES,
  PHOTO_CATEGORY_LABELS,
  isSuggestedCategory,
  type MediaCategory,
} from '@/domain/entities/media-asset';
import { fetchInspectionPhotos, type InspectionPhoto } from '@/lib/api-client/client';
import { localTimeHHmm } from '@/lib/dates';

export interface MediaGalleryProps {
  readonly appointmentId: string;
  /** Note raccolte durante il giro del veicolo (oggi salvate sulla pratica). */
  readonly inspectionNotes: string | null;
  readonly timeZone: string;
}

function sizeLabel(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} kB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Etichetta della parte ripresa; i video riprendono il giro intero e non hanno una parte. */
function labelOf(media: InspectionPhoto): string {
  if (media.kind === 'VIDEO') {
    return 'Video del veicolo';
  }
  return media.category === null ? 'Senza categoria' : PHOTO_CATEGORY_LABELS[media.category];
}

/** Media a schermo intero, chiuso con Esc o con un clic fuori. */
function Lightbox({
  media,
  index,
  total,
  timeZone,
  onClose,
}: {
  readonly media: InspectionPhoto;
  readonly index: number;
  readonly total: number;
  readonly timeZone: string;
  readonly onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Media ${index + 1} di ${total}`}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-slate-950/90 p-4"
      onClick={onClose}
    >
      {media.kind === 'VIDEO' ? (
        <video
          src={media.url}
          controls
          autoPlay
          playsInline
          aria-label="Video dell'ispezione"
          className="max-h-[80vh] max-w-full rounded-lg shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- file servito dalla rotta media, non ottimizzabile da next/image
        <img
          src={media.url}
          alt={`Foto dell'ispezione: ${labelOf(media)}`}
          className="max-h-[80vh] max-w-full rounded-lg object-contain shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        />
      )}
      <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-white">
        <span className="rounded bg-white/15 px-2 py-0.5 font-semibold">{labelOf(media)}</span>
        <span>
          Media {index + 1} di {total}
        </span>
        <span className="opacity-70">
          acquisito alle {localTimeHHmm(new Date(media.capturedAt), timeZone)}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-white/40 px-3 py-1 font-semibold hover:bg-white/10"
        >
          Chiudi
        </button>
      </div>
    </div>
  );
}

export function MediaGallery({ appointmentId, inspectionNotes, timeZone }: MediaGalleryProps) {
  const query = useQuery({
    queryKey: ['inspection-photos', appointmentId] as const,
    queryFn: () => fetchInspectionPhotos(appointmentId),
    staleTime: 30_000,
  });
  const [aperta, setAperta] = useState<number | null>(null);

  const media = query.data?.photos ?? [];
  const video = media.filter((m) => m.kind === 'VIDEO');
  const foto = media.filter((m) => m.kind !== 'VIDEO');
  // Ordine fisso (frontale, posteriore, fiancate, interni, danni, aggiuntive), i video in testa
  // perché raccontano il giro intero, e in fondo le foto senza categoria, cioè quelle scattate
  // prima che gli slot esistessero.
  const gruppi: readonly { etichetta: string; media: readonly InspectionPhoto[] }[] = [
    { etichetta: 'Video del veicolo', media: video },
    ...PHOTO_CATEGORIES.map((categoria) => ({
      etichetta: PHOTO_CATEGORY_LABELS[categoria],
      media: foto.filter((p) => p.category === categoria),
    })),
    { etichetta: 'Senza categoria', media: foto.filter((p) => p.category === null) },
  ].filter((g) => g.media.length > 0);
  // Il giro consigliato non è obbligatorio: se manca qualcosa lo si segnala, senza allarmare.
  const mancanti: readonly MediaCategory[] = PHOTO_CATEGORIES.filter(
    (c) => isSuggestedCategory(c) && !foto.some((p) => p.category === c),
  );
  // Sezione silenziosa finché non c'è niente da mostrare: una pratica non ispezionata non deve
  // riempire il pannello di righe vuote.
  if (query.isPending || (media.length === 0 && inspectionNotes === null)) {
    return null;
  }

  const conteggio = [
    foto.length === 0 ? null : foto.length === 1 ? '1 foto' : `${foto.length} foto`,
    video.length === 0 ? null : video.length === 1 ? '1 video' : `${video.length} video`,
  ]
    .filter((x) => x !== null)
    .join(' · ');

  return (
    <section>
      <h3 className="mb-1 text-sm font-bold text-slate-900">Ispezione al veicolo</h3>
      {query.isError ? (
        <p className="text-status-in-progress-ink text-sm">
          Foto e video non disponibili in questo momento: riprova fra qualche istante.
        </p>
      ) : null}

      {inspectionNotes !== null ? (
        <p className="mb-3 rounded-md bg-slate-50 px-3 py-2 text-sm whitespace-pre-wrap text-slate-800">
          {inspectionNotes}
        </p>
      ) : null}

      {media.length === 0 ? (
        <p className="text-sm text-slate-500">Nessuna foto o video acquisiti dal tablet.</p>
      ) : (
        <>
          {/* Raggruppati per parte del veicolo: chi guarda deve sapere cosa sta vedendo, non
              scorrere sei miniature quadrate tutte uguali. */}
          <div className="flex flex-col gap-3">
            {gruppi.map((gruppo) => (
              <div key={gruppo.etichetta}>
                <h4 className="mb-1 flex items-baseline gap-2 text-xs font-bold tracking-wide text-slate-500 uppercase">
                  {gruppo.etichetta}
                  <span className="text-ink-muted text-[10px] font-normal">
                    {gruppo.media.length === 1 ? '1 file' : `${gruppo.media.length} file`}
                  </span>
                </h4>
                <ul className="grid grid-cols-3 gap-2">
                  {gruppo.media.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => setAperta(media.indexOf(m))}
                        className="group focus:ring-brand-blue relative block aspect-square w-full overflow-hidden rounded-md border border-slate-200 focus:ring-2 focus:outline-none"
                        aria-label={`Ingrandisci: ${gruppo.etichetta}`}
                      >
                        {m.archivedAt !== null ? (
                          <span className="flex h-full w-full flex-col items-center justify-center bg-slate-100 px-1 text-center text-[10px] text-slate-500">
                            <span aria-hidden="true" className="text-lg">
                              🗄️
                            </span>
                            file archiviato
                          </span>
                        ) : m.kind === 'VIDEO' ? (
                          <span className="flex h-full w-full items-center justify-center bg-slate-900 text-2xl text-white">
                            <span aria-hidden="true">▶</span>
                          </span>
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element -- file servito dalla rotta media, non ottimizzabile da next/image
                          <img
                            src={m.url}
                            alt=""
                            className="h-full w-full object-cover transition group-hover:scale-105"
                          />
                        )}
                        <span className="absolute right-1 bottom-1 rounded bg-slate-900/70 px-1 text-[10px] font-semibold text-white">
                          {sizeLabel(m.sizeBytes)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">{conteggio} dal tablet · clicca per aprire</p>
          {mancanti.length > 0 ? (
            <p className="mt-1 text-xs text-slate-500">
              Del giro consigliato mancano:{' '}
              {mancanti.map((c) => PHOTO_CATEGORY_LABELS[c]).join(', ')}. Le riprese non sono
              obbligatorie: il check-in si conclude comunque.
            </p>
          ) : null}
        </>
      )}

      {aperta !== null && media[aperta] !== undefined ? (
        <Lightbox
          media={media[aperta]}
          index={aperta}
          total={media.length}
          timeZone={timeZone}
          onClose={() => setAperta(null)}
        />
      ) : null}
    </section>
  );
}
