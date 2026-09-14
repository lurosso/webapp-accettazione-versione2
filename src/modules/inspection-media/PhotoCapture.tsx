'use client';

// Giro fotografico del veicolo a slot: una casella grande per ogni parte da riprendere.
// Le quattro riprese obbligatorie sono numerate nell'ordine del giro attorno all'auto (davanti,
// dietro, lato guida, lato passeggero), le due facoltative stanno sotto. A colpo d'occhio si vede
// cosa manca: bordo ambra tratteggiato da fare, verde con la spunta fatto.
//
// Ogni slot apre la fotocamera posteriore (`capture="environment"`). L'anteprima locale compare
// subito, con la rotella, mentre il file viaggia verso il server; se il salvataggio fallisce la
// foto sparisce e compare l'errore, perché una foto che sembra esserci ma non è stata salvata è
// peggio di nessuna foto. L'intera casella è il bersaglio: con i guanti non si mira a un'icona.
import { useEffect, useRef, useState } from 'react';
import {
  PHOTO_CATEGORIES,
  PHOTO_CATEGORY_LABELS,
  REQUIRED_PHOTO_CATEGORIES,
  isRequiredCategory,
  type MediaCategory,
} from '@/domain/entities/media-asset';
import { ApiError, uploadInspectionPhoto, type InspectionPhoto } from '@/lib/api-client/client';
import { cn } from '@/lib/utils/cn';

export interface PhotoCaptureProps {
  readonly appointmentId: string;
  readonly photos: readonly InspectionPhoto[];
  readonly onUploaded: (photo: InspectionPhoto) => void;
  /** Riprese obbligatorie ancora mancanti (calcolate dalla schermata di check-in). */
  readonly missing: readonly MediaCategory[];
}

/** Foto in corso di caricamento, tenuta accanto al proprio slot. */
interface Caricamento {
  readonly id: string;
  readonly category: MediaCategory;
  readonly previewUrl: string;
}

/** Suggerimento di inquadratura: dice cosa deve entrare nella foto, non solo il nome dello slot. */
const SUGGERIMENTI: Readonly<Record<MediaCategory, string>> = {
  FRONT: 'Paraurti e cofano',
  REAR: 'Paraurti e portellone',
  LEFT: 'Fiancata lato guida',
  RIGHT: 'Fiancata lato passeggero',
  INTERIOR: 'Abitacolo e cruscotto',
  DAMAGE: 'Graffi, ammaccature, cristalli',
};

/** Icona a tratto per ogni parte: si riconosce anche con il sole sullo schermo. */
function IconaParte({ category }: { readonly category: MediaCategory }) {
  const comune = {
    viewBox: '0 0 48 32',
    className: 'h-10 w-14',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (category) {
    case 'FRONT':
      return (
        <svg {...comune}>
          <path d="M8 22h32v6H8zM10 22l4-10h20l4 10M6 28h6M36 28h6" />
          <circle cx="14" cy="25" r="1.5" />
          <circle cx="34" cy="25" r="1.5" />
        </svg>
      );
    case 'REAR':
      return (
        <svg {...comune}>
          <path d="M8 22h32v6H8zM10 22l4-10h20l4 10M12 25h6M30 25h6M18 16h12" />
        </svg>
      );
    case 'LEFT':
      return (
        <svg {...comune}>
          <path d="M4 24h40v-6l-8-8H16l-8 8v6zM16 10v8M30 10v8" />
          <circle cx="13" cy="26" r="3" />
          <circle cx="35" cy="26" r="3" />
          <path d="M2 18h4" />
        </svg>
      );
    case 'RIGHT':
      return (
        <svg {...comune}>
          <path d="M4 24h40v-6l-8-8H12l-8 8v6zM18 10v8M32 10v8" />
          <circle cx="13" cy="26" r="3" />
          <circle cx="35" cy="26" r="3" />
          <path d="M42 18h4" />
        </svg>
      );
    case 'INTERIOR':
      return (
        <svg {...comune}>
          <circle cx="24" cy="16" r="9" />
          <path d="M24 7v9l6 4M6 28h36" />
        </svg>
      );
    case 'DAMAGE':
      return (
        <svg {...comune}>
          <path d="M6 26 18 8l6 9 5-5 13 14zM20 20l4 6" />
        </svg>
      );
  }
}

export function PhotoCapture({ appointmentId, photos, onUploaded, missing }: PhotoCaptureProps) {
  const inputRefs = useRef(new Map<MediaCategory, HTMLInputElement | null>());
  const [inCorso, setInCorso] = useState<readonly Caricamento[]>([]);
  const [errore, setErrore] = useState<string | null>(null);

  // Le anteprime locali occupano memoria finché non vengono liberate.
  useEffect(() => {
    return () => {
      for (const c of inCorso) {
        URL.revokeObjectURL(c.previewUrl);
      }
    };
  }, [inCorso]);

  const onFile = async (file: File, category: MediaCategory): Promise<void> => {
    setErrore(null);
    const previewUrl = URL.createObjectURL(file);
    const id = `${category}-${file.size}-${previewUrl}`;
    setInCorso((precedenti) => [...precedenti, { id, category, previewUrl }]);
    try {
      const salvata = await uploadInspectionPhoto(appointmentId, file, category);
      onUploaded(salvata);
    } catch (cause) {
      setErrore(
        cause instanceof ApiError
          ? cause.message
          : `Foto "${PHOTO_CATEGORY_LABELS[category]}" non salvata: controlla la connessione e riprova.`,
      );
    } finally {
      setInCorso((precedenti) => precedenti.filter((c) => c.id !== id));
      URL.revokeObjectURL(previewUrl);
    }
  };

  const obbligatorie = PHOTO_CATEGORIES.filter(isRequiredCategory);
  const facoltative = PHOTO_CATEGORIES.filter((c) => !isRequiredCategory(c));

  const slot = (category: MediaCategory): React.ReactNode => {
    const scattate = photos.filter((p) => p.category === category);
    const ultima = scattate.at(-1);
    const caricamento = inCorso.find((c) => c.category === category);
    const obbligatoria = isRequiredCategory(category);
    const mancante = missing.includes(category);
    const numero = (REQUIRED_PHOTO_CATEGORIES as readonly MediaCategory[]).indexOf(category) + 1;

    return (
      <li key={category} className="min-w-0">
        <button
          type="button"
          onClick={() => inputRefs.current.get(category)?.click()}
          aria-label={`${PHOTO_CATEGORY_LABELS[category]}: ${
            scattate.length === 0 ? 'scatta la foto' : 'scatta un altro scatto'
          }`}
          className={cn(
            'flex w-full flex-col overflow-hidden rounded-2xl border-[3px] bg-white text-left shadow-sm transition-colors',
            'focus-visible:ring-brand-blue-light focus-visible:ring-4 focus-visible:outline-none active:bg-slate-50',
            mancante
              ? 'border-dashed border-amber-500'
              : scattate.length > 0
                ? 'border-status-completed'
                : 'border-dashed border-slate-300',
          )}
        >
          <span className="relative block aspect-[4/3] w-full bg-slate-100">
            {caricamento !== undefined ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={caricamento.previewUrl}
                  alt=""
                  className="h-full w-full object-cover opacity-50"
                />
                <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-900/40 text-white">
                  <span
                    aria-hidden="true"
                    className="h-10 w-10 animate-spin rounded-full border-4 border-white/40 border-t-white"
                  />
                  <span className="text-base font-semibold">Salvataggio…</span>
                </span>
              </>
            ) : ultima !== undefined ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={ultima.url}
                  alt={`Foto ${PHOTO_CATEGORY_LABELS[category]}`}
                  className="h-full w-full object-cover"
                />
                <span className="bg-status-completed absolute top-2 left-2 flex h-9 w-9 items-center justify-center rounded-full text-xl font-black text-white shadow">
                  ✓
                </span>
                {scattate.length > 1 ? (
                  <span className="absolute top-2 right-2 rounded-full bg-slate-900/80 px-2.5 py-1 text-sm font-bold text-white">
                    {scattate.length} scatti
                  </span>
                ) : null}
                <span className="absolute right-2 bottom-2 rounded-lg bg-white/90 px-2.5 py-1 text-sm font-semibold text-slate-800">
                  Tocca per un altro scatto
                </span>
              </>
            ) : (
              <span
                className={cn(
                  'absolute inset-0 flex flex-col items-center justify-center gap-2',
                  mancante ? 'text-amber-800' : 'text-slate-500',
                )}
              >
                <IconaParte category={category} />
                <span className="text-lg font-bold">
                  {obbligatoria ? 'Tocca per scattare' : 'Facoltativa'}
                </span>
              </span>
            )}
            {obbligatoria ? (
              <span
                aria-hidden="true"
                className={cn(
                  'absolute bottom-2 left-2 flex h-9 w-9 items-center justify-center rounded-full font-mono text-lg font-black text-white shadow',
                  mancante ? 'bg-amber-600' : 'bg-slate-900',
                )}
              >
                {numero}
              </span>
            ) : null}
          </span>
          <span className="flex flex-col gap-0.5 px-4 py-3">
            <span className="text-xl font-bold text-slate-900">
              {PHOTO_CATEGORY_LABELS[category]}
            </span>
            <span className="text-sm text-slate-600">{SUGGERIMENTI[category]}</span>
          </span>
        </button>
        <input
          ref={(el) => {
            inputRefs.current.set(category, el);
          }}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          data-category={category}
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Il campo viene svuotato subito: così si può riscattare lo stesso soggetto.
            event.target.value = '';
            if (file !== undefined) {
              void onFile(file, category);
            }
          }}
        />
      </li>
    );
  };

  return (
    <section className="flex flex-col gap-5">
      {errore !== null ? (
        <p
          role="alert"
          className="bg-status-no-show-soft rounded-2xl border-2 border-red-200 px-5 py-4 text-lg font-semibold text-red-900"
        >
          {errore}
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-2xl font-bold">Giro del veicolo</h2>
          <span className="text-base font-semibold text-slate-600">
            {obbligatorie.length} riprese obbligatorie
          </span>
        </div>
        <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4">{obbligatorie.map(slot)}</ul>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-xl font-bold text-slate-700">Se serve</h2>
          <span className="text-base text-slate-500">facoltative</span>
        </div>
        <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4">{facoltative.map(slot)}</ul>
      </div>
    </section>
  );
}
