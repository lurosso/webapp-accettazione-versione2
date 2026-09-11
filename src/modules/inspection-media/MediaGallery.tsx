'use client';

// Galleria delle foto scattate al tablet, mostrata nel pannello di dettaglio della dashboard.
// Serve a chi sta al banco: quando il cliente chiede "cosa avete visto sull'auto?", le foto e le
// note dell'ispezione sono lì, senza dover cercare il tablet o chiamare il collega che l'ha fatta.
//
// Le foto arrivano dalla stessa rotta autenticata usata dal tablet. Se la richiesta fallisce la
// sezione lo dice e basta: il resto del pannello (telefono del cliente, cronologia) deve restare
// utilizzabile, perché è quello che serve per lavorare.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  PHOTO_CATEGORIES,
  PHOTO_CATEGORY_LABELS,
  isRequiredCategory,
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

/** Foto a schermo intero, chiusa con Esc o con un clic fuori. */
function Lightbox({
  photo,
  index,
  total,
  timeZone,
  onClose,
}: {
  readonly photo: InspectionPhoto;
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
      aria-label={`Foto ${index + 1} di ${total}`}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-slate-950/90 p-4"
      onClick={onClose}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- file servito dalla rotta media, non ottimizzabile da next/image */}
      <img
        src={photo.url}
        alt={
          photo.category === null
            ? `Foto ${index + 1} dell'ispezione`
            : `Foto dell'ispezione: ${PHOTO_CATEGORY_LABELS[photo.category]}`
        }
        className="max-h-[80vh] max-w-full rounded-lg object-contain shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      />
      <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-white">
        <span className="rounded bg-white/15 px-2 py-0.5 font-semibold">
          {photo.category === null ? 'Senza categoria' : PHOTO_CATEGORY_LABELS[photo.category]}
        </span>
        <span>
          Foto {index + 1} di {total}
        </span>
        <span className="opacity-70">
          scattata alle {localTimeHHmm(new Date(photo.capturedAt), timeZone)}
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

  const photos = query.data?.photos ?? [];
  // Ordine fisso (frontale, posteriore, fiancate, interni, danni) e in fondo le foto senza
  // categoria, cioè quelle scattate prima che gli slot esistessero.
  const gruppi: readonly { etichetta: string; foto: readonly InspectionPhoto[] }[] = [
    ...PHOTO_CATEGORIES.map((categoria) => ({
      etichetta: PHOTO_CATEGORY_LABELS[categoria],
      foto: photos.filter((p) => p.category === categoria),
    })),
    { etichetta: 'Senza categoria', foto: photos.filter((p) => p.category === null) },
  ].filter((g) => g.foto.length > 0);
  const mancanti: readonly MediaCategory[] = PHOTO_CATEGORIES.filter(
    (c) => isRequiredCategory(c) && !photos.some((p) => p.category === c),
  );
  // Sezione silenziosa finché non c'è niente da mostrare: una pratica non ispezionata non deve
  // riempire il pannello di righe vuote.
  if (query.isPending || (photos.length === 0 && inspectionNotes === null)) {
    return null;
  }

  return (
    <section>
      <h3 className="mb-1 text-sm font-bold text-slate-900">Ispezione al veicolo</h3>
      {query.isError ? (
        <p className="text-sm text-amber-700">
          Foto non disponibili in questo momento: riprova fra qualche istante.
        </p>
      ) : null}

      {inspectionNotes !== null ? (
        <p className="mb-3 rounded-md bg-slate-50 px-3 py-2 text-sm whitespace-pre-wrap text-slate-800">
          {inspectionNotes}
        </p>
      ) : null}

      {photos.length === 0 ? (
        <p className="text-sm text-slate-500">Nessuna foto acquisita dal tablet.</p>
      ) : (
        <>
          {/* Raggruppate per parte del veicolo: chi guarda deve sapere cosa sta vedendo, non
              scorrere sei miniature quadrate tutte uguali. */}
          <div className="flex flex-col gap-3">
            {gruppi.map((gruppo) => (
              <div key={gruppo.etichetta}>
                <h4 className="mb-1 flex items-baseline gap-2 text-xs font-bold tracking-wide text-slate-500 uppercase">
                  {gruppo.etichetta}
                  <span className="text-[10px] font-normal text-slate-400">
                    {gruppo.foto.length === 1 ? '1 foto' : `${gruppo.foto.length} foto`}
                  </span>
                </h4>
                <ul className="grid grid-cols-3 gap-2">
                  {gruppo.foto.map((photo) => (
                    <li key={photo.id}>
                      <button
                        type="button"
                        onClick={() => setAperta(photos.indexOf(photo))}
                        className="group focus:ring-brand-blue relative block aspect-square w-full overflow-hidden rounded-md border border-slate-200 focus:ring-2 focus:outline-none"
                        aria-label={`Ingrandisci la foto: ${gruppo.etichetta}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- file servito dalla rotta media, non ottimizzabile da next/image */}
                        <img
                          src={photo.url}
                          alt=""
                          className="h-full w-full object-cover transition group-hover:scale-105"
                        />
                        <span className="absolute right-1 bottom-1 rounded bg-slate-900/70 px-1 text-[10px] font-semibold text-white">
                          {sizeLabel(photo.sizeBytes)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {photos.length === 1 ? '1 foto acquisita' : `${photos.length} foto acquisite`} dal
            tablet · clicca per ingrandire
          </p>
          {mancanti.length > 0 ? (
            <p className="mt-1 text-xs text-amber-700">
              Riprese obbligatorie non presenti:{' '}
              {mancanti.map((c) => PHOTO_CATEGORY_LABELS[c]).join(', ')}. Sono pratiche chiuse prima
              dell&apos;introduzione degli slot fotografici.
            </p>
          ) : null}
        </>
      )}

      {aperta !== null && photos[aperta] !== undefined ? (
        <Lightbox
          photo={photos[aperta]}
          index={aperta}
          total={photos.length}
          timeZone={timeZone}
          onClose={() => setAperta(null)}
        />
      ) : null}
    </section>
  );
}
