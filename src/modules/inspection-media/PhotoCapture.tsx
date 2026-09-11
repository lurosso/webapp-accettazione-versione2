'use client';

// Acquisizione foto dal tablet: apre direttamente la fotocamera posteriore grazie a
// `capture="environment"`, mostra l'anteprima locale mentre il file viaggia verso il server e
// solo a salvataggio riuscito tiene la foto nell'elenco.
//
// L'anteprima viene creata in locale per dare risposta immediata: l'accettatore vede subito lo
// scatto, anche prima che il caricamento finisca. Se il salvataggio fallisce la foto sparisce e
// compare l'errore, perché una foto che sembra esserci ma non è stata salvata è peggio di nessuna.
import { useEffect, useRef, useState } from 'react';
import { ApiError, uploadInspectionPhoto, type InspectionPhoto } from '@/lib/api-client/client';

export interface PhotoCaptureProps {
  readonly appointmentId: string;
  readonly photos: readonly InspectionPhoto[];
  readonly onUploaded: (photo: InspectionPhoto) => void;
}

/** Foto in corso di caricamento: mostrata subito con l'anteprima locale. */
interface Caricamento {
  readonly id: string;
  readonly previewUrl: string;
}

export function PhotoCapture({ appointmentId, photos, onUploaded }: PhotoCaptureProps) {
  const inputRef = useRef<HTMLInputElement>(null);
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

  const onFile = async (file: File): Promise<void> => {
    setErrore(null);
    const previewUrl = URL.createObjectURL(file);
    const id = `${file.name}-${file.size}-${previewUrl}`;
    setInCorso((precedenti) => [...precedenti, { id, previewUrl }]);
    try {
      const salvata = await uploadInspectionPhoto(appointmentId, file);
      onUploaded(salvata);
    } catch (cause) {
      setErrore(
        cause instanceof ApiError
          ? cause.message
          : 'Foto non salvata: controlla la connessione e riprova.',
      );
    } finally {
      setInCorso((precedenti) => precedenti.filter((c) => c.id !== id));
      URL.revokeObjectURL(previewUrl);
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-slate-900">
          Foto del veicolo
          <span className="ml-2 text-base font-normal text-slate-500">
            {photos.length === 0
              ? 'nessuna'
              : photos.length === 1
                ? '1 scattata'
                : `${photos.length} scattate`}
          </span>
        </h2>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="h-touch rounded-xl bg-slate-900 px-6 text-lg font-semibold text-white shadow-sm hover:bg-slate-700 focus-visible:ring-4 focus-visible:ring-slate-400 focus-visible:outline-none"
        >
          Scatta foto
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Il campo viene svuotato subito: così si può riscattare lo stesso soggetto.
            event.target.value = '';
            if (file !== undefined) {
              void onFile(file);
            }
          }}
        />
      </div>

      {errore !== null ? (
        <p
          role="alert"
          className="bg-status-no-show-soft rounded-lg px-4 py-3 text-base text-red-900"
        >
          {errore}
        </p>
      ) : null}

      {photos.length === 0 && inCorso.length === 0 ? (
        <p className="rounded-xl border-2 border-dashed border-slate-300 px-4 py-8 text-center text-base text-slate-500">
          Fotografa i punti critici della carrozzeria prima di prendere in consegna la vettura.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {inCorso.map((c) => (
            <li
              key={c.id}
              className="relative aspect-square overflow-hidden rounded-xl bg-slate-200"
            >
              {/* Anteprima locale: si vede lo scatto mentre il file viaggia. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={c.previewUrl}
                alt="Foto in caricamento"
                className="h-full w-full object-cover opacity-50"
              />
              <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-900/40 text-white">
                <span
                  aria-hidden="true"
                  className="h-8 w-8 animate-spin rounded-full border-4 border-white/40 border-t-white"
                />
                <span className="text-sm font-semibold">Caricamento…</span>
              </span>
            </li>
          ))}
          {photos.map((p, indice) => (
            <li
              key={p.id}
              className="relative aspect-square overflow-hidden rounded-xl bg-slate-200"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.url}
                alt={`Foto ${indice + 1} del veicolo`}
                className="h-full w-full object-cover"
              />
              <span className="absolute right-1 bottom-1 rounded bg-slate-900/70 px-1.5 py-0.5 text-xs font-semibold text-white">
                {Math.max(1, Math.round(p.sizeBytes / 1024))} kB
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
