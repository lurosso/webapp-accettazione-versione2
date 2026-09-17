'use client';

// Documentazione del veicolo al check-in. Un solo passaggio obbligatorio, il VIDEO: finché manca,
// il suo pulsante è ambra e la pratica non si chiude. Le foto sono tutte facoltative e si fanno in
// tre modi, dal più guidato al più libero:
// - il giro dell'auto a slot (davanti, dietro, fiancate, interni, danni): caselle grandi che aprono
//   la fotocamera posteriore e dicono a colpo d'occhio cosa è stato ripreso (bordo verde);
// - "+ Foto": uno scatto in più quando serve, senza dover scegliere una casella;
// - "Video": la ripresa breve del giro (mp4/mov/webm dalla fotocamera del tablet).
// Anteprima subito, rotella mentre il file viaggia; se il salvataggio fallisce il media sparisce e
// compare l'errore, perché una foto che sembra esserci ma non è stata salvata è peggio di nessuna
// foto. Tutti i bersagli sono almeno 44 px: si usa in piedi, con i guanti.
import { useEffect, useRef, useState } from 'react';
import {
  PHOTO_CATEGORIES,
  PHOTO_CATEGORY_LABELS,
  SUGGESTED_PHOTO_CATEGORIES,
  isSuggestedCategory,
  type MediaCategory,
} from '@/domain/entities/media-asset';
import { ApiError, uploadInspectionMedia, type InspectionPhoto } from '@/lib/api-client/client';
import { cn } from '@/lib/utils/cn';

export interface PhotoCaptureProps {
  readonly appointmentId: string;
  readonly media: readonly InspectionPhoto[];
  readonly onUploaded: (media: InspectionPhoto) => void;
}

/** Media in corso di caricamento, tenuto accanto al proprio slot (o fra gli extra). */
interface Caricamento {
  readonly id: string;
  readonly category: MediaCategory | null;
  readonly kind: 'PHOTO' | 'VIDEO';
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
  EXTRA: 'Qualunque dettaglio utile',
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
    case 'EXTRA':
      return (
        <svg {...comune}>
          <path d="M24 6v20M14 16h20" />
        </svg>
      );
  }
}

export function PhotoCapture({ appointmentId, media, onUploaded }: PhotoCaptureProps) {
  const inputRefs = useRef(new Map<string, HTMLInputElement | null>());
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

  const onFile = async (
    file: File,
    category: MediaCategory | null,
    kind: 'PHOTO' | 'VIDEO',
  ): Promise<void> => {
    setErrore(null);
    const previewUrl = URL.createObjectURL(file);
    const id = `${kind}-${category ?? 'video'}-${file.size}-${previewUrl}`;
    setInCorso((precedenti) => [...precedenti, { id, category, kind, previewUrl }]);
    try {
      const salvato = await uploadInspectionMedia(appointmentId, file, category);
      onUploaded(salvato);
    } catch (cause) {
      setErrore(
        cause instanceof ApiError
          ? cause.message
          : `${kind === 'VIDEO' ? 'Video' : 'Foto'} non salvat${kind === 'VIDEO' ? 'o' : 'a'}: controlla la connessione e riprova.`,
      );
    } finally {
      setInCorso((precedenti) => precedenti.filter((c) => c.id !== id));
      URL.revokeObjectURL(previewUrl);
    }
  };

  /** Input nascosto per uno slot o per i pulsanti liberi; la chiave lo distingue. */
  const inputNascosto = (
    key: string,
    accept: string,
    onPick: (file: File) => void,
  ): React.ReactNode => (
    <input
      ref={(el) => {
        inputRefs.current.set(key, el);
      }}
      type="file"
      accept={accept}
      capture="environment"
      className="sr-only"
      data-testid={`input-${key.toLowerCase()}`}
      onChange={(event) => {
        const file = event.target.files?.[0];
        // Il campo viene svuotato subito: così si può riprendere lo stesso soggetto.
        event.target.value = '';
        if (file !== undefined) {
          onPick(file);
        }
      }}
    />
  );

  const foto = media.filter((m) => m.kind !== 'VIDEO');
  const video = media.filter((m) => m.kind === 'VIDEO');
  const extra = foto.filter((p) => p.category === 'EXTRA' || p.category === null);
  const giro = PHOTO_CATEGORIES.filter((c) => c !== 'EXTRA');
  const suggerite = giro.filter(isSuggestedCategory);
  const facoltative = giro.filter((c) => !isSuggestedCategory(c));

  const slot = (category: MediaCategory): React.ReactNode => {
    const scattate = foto.filter((p) => p.category === category);
    const ultima = scattate.at(-1);
    const caricamento = inCorso.find((c) => c.category === category);
    const numero = (SUGGESTED_PHOTO_CATEGORIES as readonly MediaCategory[]).indexOf(category) + 1;

    return (
      <li key={category} className="min-w-0">
        <button
          type="button"
          onClick={() => inputRefs.current.get(category)?.click()}
          aria-label={`${PHOTO_CATEGORY_LABELS[category]}: ${
            scattate.length === 0 ? 'scatta la foto' : 'scatta un altro scatto'
          }`}
          className={cn(
            'flex min-h-11 w-full flex-col overflow-hidden rounded-2xl border-[3px] bg-white text-left shadow-sm transition-colors',
            'focus-visible:ring-brand-blue-light focus-visible:ring-4 focus-visible:outline-none active:bg-slate-50',
            scattate.length > 0 ? 'border-status-completed' : 'border-dashed border-slate-300',
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
              <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-500">
                <IconaParte category={category} />
                <span className="text-lg font-bold">Tocca per scattare</span>
              </span>
            )}
            {numero > 0 ? (
              <span
                aria-hidden="true"
                className="absolute bottom-2 left-2 flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 font-mono text-lg font-black text-white shadow"
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
        {inputNascosto(category, 'image/*', (file) => void onFile(file, category, 'PHOTO'))}
      </li>
    );
  };

  const extraInCorso = inCorso.filter((c) => c.kind === 'VIDEO' || c.category === 'EXTRA');

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
            foto facoltative · {foto.length} foto, {video.length} video
          </span>
        </div>
        <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4">{suggerite.map(slot)}</ul>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-xl font-bold text-slate-700">Video e altri scatti</h2>
          <span className="text-base text-slate-500">il video è obbligatorio, il resto no</span>
        </div>
        <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4">{facoltative.map(slot)}</ul>

        {/* Comandi liberi: bersagli alti 56 px, si premono con il pollice tenendo il tablet.
            Il video è l'unico obbligatorio, quindi finché manca è il pulsante più evidente. */}
        <div className="flex flex-wrap gap-3" aria-label="Foto aggiuntive e video">
          <button
            type="button"
            onClick={() => inputRefs.current.get('VIDEO')?.click()}
            aria-label={
              video.length === 0
                ? 'Registra il video del veicolo (obbligatorio)'
                : 'Registra un altro video del veicolo'
            }
            data-testid="registra-video"
            className={cn(
              'flex min-h-14 min-w-14 flex-[2] items-center justify-center gap-3 rounded-2xl border-[3px] px-5 text-xl font-bold shadow-sm focus-visible:ring-4 focus-visible:ring-slate-400 focus-visible:outline-none',
              video.length === 0
                ? 'border-amber-500 bg-amber-100 text-amber-900 active:bg-amber-200'
                : 'border-status-completed bg-white text-slate-900 active:bg-slate-100',
            )}
          >
            <span aria-hidden="true" className="text-2xl leading-none">
              {video.length === 0 ? '▶' : '✓'}
            </span>
            {video.length === 0 ? 'Video · obbligatorio' : 'Rifai il video'}
          </button>
          <button
            type="button"
            onClick={() => inputRefs.current.get('EXTRA')?.click()}
            aria-label="Aggiungi una foto"
            data-testid="aggiungi-foto"
            className="bg-brand-secondary active:bg-brand-blue-dark flex min-h-14 min-w-14 flex-1 items-center justify-center gap-3 rounded-2xl px-5 text-xl font-bold text-white shadow-sm focus-visible:ring-4 focus-visible:ring-slate-400 focus-visible:outline-none"
          >
            <span aria-hidden="true" className="text-3xl leading-none">
              +
            </span>
            Foto
          </button>
          {inputNascosto('EXTRA', 'image/*', (file) => void onFile(file, 'EXTRA', 'PHOTO'))}
          {inputNascosto('VIDEO', 'video/*', (file) => void onFile(file, null, 'VIDEO'))}
        </div>

        {extra.length > 0 || video.length > 0 || extraInCorso.length > 0 ? (
          <ul
            className="grid grid-cols-3 gap-3 lg:grid-cols-6"
            aria-label="Foto aggiuntive e video acquisiti"
          >
            {extraInCorso.map((c) => (
              <li
                key={c.id}
                className="flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border-2 border-slate-300 bg-slate-100 text-slate-600"
              >
                <span
                  aria-hidden="true"
                  className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-slate-700"
                />
                <span className="text-sm font-semibold">
                  {c.kind === 'VIDEO' ? 'Video…' : 'Foto…'}
                </span>
              </li>
            ))}
            {video.map((v) => (
              <li
                key={v.id}
                className="border-status-completed relative aspect-square overflow-hidden rounded-xl border-2 bg-black"
              >
                <video
                  src={v.url}
                  controls
                  preload="metadata"
                  playsInline
                  className="h-full w-full object-cover"
                  aria-label="Video del veicolo"
                />
                <span className="absolute top-1 left-1 rounded bg-slate-900/80 px-1.5 py-0.5 text-xs font-bold text-white">
                  VIDEO
                </span>
              </li>
            ))}
            {extra.map((p) => (
              <li
                key={p.id}
                className="border-status-completed relative aspect-square overflow-hidden rounded-xl border-2"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="Foto aggiuntiva" className="h-full w-full object-cover" />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
