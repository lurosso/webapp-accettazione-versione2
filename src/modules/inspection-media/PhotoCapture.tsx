'use client';

// Acquisizione foto dal tablet, organizzata in slot: una casella per ogni parte del veicolo.
// Il pulsante generico "scatta una foto" lasciava all'accettatore il compito di ricordarsi cosa
// aveva già fotografato; con gli slot il giro dell'auto è guidato e si vede a colpo d'occhio cosa
// manca. Le quattro fiancate sono obbligatorie: senza, il check-in non si chiude.
//
// Ogni slot apre la fotocamera posteriore (`capture="environment"`). L'anteprima locale compare
// subito, con la rotella, mentre il file viaggia verso il server; se il salvataggio fallisce la
// foto sparisce e compare l'errore, perché una foto che sembra esserci ma non è stata salvata è
// peggio di nessuna foto.
import { useEffect, useRef, useState } from 'react';
import {
  PHOTO_CATEGORIES,
  PHOTO_CATEGORY_LABELS,
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

  const obbligatorieFatte = 4 - missing.length;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-xl font-bold text-slate-900">Giro del veicolo</h2>
        <p
          className={cn(
            'text-base font-semibold',
            missing.length === 0 ? 'text-status-completed' : 'text-slate-600',
          )}
        >
          {obbligatorieFatte} di 4 foto obbligatorie
          {missing.length === 0 ? ' · completo' : ''}
        </p>
      </div>

      {errore !== null ? (
        <p
          role="alert"
          className="bg-status-no-show-soft rounded-lg px-4 py-3 text-base text-red-900"
        >
          {errore}
        </p>
      ) : null}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {PHOTO_CATEGORIES.map((category) => {
          const scattate = photos.filter((p) => p.category === category);
          const ultima = scattate.at(-1);
          const caricamento = inCorso.find((c) => c.category === category);
          const obbligatoria = isRequiredCategory(category);
          const mancante = missing.includes(category);

          return (
            <li key={category}>
              <button
                type="button"
                onClick={() => inputRefs.current.get(category)?.click()}
                aria-label={`${PHOTO_CATEGORY_LABELS[category]}: ${
                  scattate.length === 0 ? 'scatta la foto' : 'scatta un altro scatto'
                }`}
                className={cn(
                  'flex w-full flex-col overflow-hidden rounded-xl border-2 bg-white text-left transition-colors',
                  'focus-visible:ring-brand-blue-light focus-visible:ring-4 focus-visible:outline-none',
                  mancante
                    ? 'border-status-in-progress hover:border-brand-blue'
                    : scattate.length > 0
                      ? 'border-status-completed'
                      : 'hover:border-brand-blue border-dashed border-slate-300',
                )}
              >
                <span className="relative block aspect-square w-full bg-slate-100">
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
                          className="h-8 w-8 animate-spin rounded-full border-4 border-white/40 border-t-white"
                        />
                        <span className="text-sm font-semibold">Caricamento…</span>
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
                      {scattate.length > 1 ? (
                        <span className="absolute top-1.5 right-1.5 rounded-full bg-slate-900/75 px-2 py-0.5 text-xs font-bold text-white">
                          {scattate.length} scatti
                        </span>
                      ) : null}
                      <span className="bg-status-completed absolute right-1.5 bottom-1.5 rounded-full px-2 py-0.5 text-xs font-bold text-white">
                        ✓ fatta
                      </span>
                    </>
                  ) : (
                    <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-slate-500">
                      <span aria-hidden="true" className="text-4xl leading-none">
                        📷
                      </span>
                      <span className="text-sm font-semibold">
                        {obbligatoria ? 'Da scattare' : 'Facoltativa'}
                      </span>
                    </span>
                  )}
                </span>
                <span className="flex flex-col gap-0.5 px-3 py-2">
                  <span className="flex items-center gap-2 text-base font-bold text-slate-900">
                    {PHOTO_CATEGORY_LABELS[category]}
                    {obbligatoria ? (
                      <span
                        aria-hidden="true"
                        className="text-status-no-show text-lg leading-none font-black"
                        title="Obbligatoria"
                      >
                        *
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-slate-500">{SUGGERIMENTI[category]}</span>
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
        })}
      </ul>

      <p className="text-sm text-slate-500">
        Le voci con <span className="text-status-no-show font-black">*</span> sono obbligatorie.
        Toccando uno slot già fatto si aggiunge un altro scatto della stessa parte.
      </p>
    </section>
  );
}
