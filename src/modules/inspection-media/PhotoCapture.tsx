'use client';

// Documentazione del veicolo al check-in. Un solo passaggio obbligatorio, il VIDEO: finché manca,
// il suo pulsante è ambra e la pratica non si chiude. Le foto sono tutte facoltative e si fanno in
// tre modi, dal più guidato al più libero:
// - il giro dell'auto a slot (davanti, dietro, fiancate, interni, danni): caselle grandi che aprono
//   la fotocamera posteriore e dicono a colpo d'occhio cosa è stato ripreso (bordo verde);
// - "+ Foto": uno scatto in più quando serve, senza dover scegliere una casella;
// - "Video": la ripresa breve del giro (mp4/mov/webm dalla fotocamera del tablet).
// Anteprima subito, con la percentuale mentre il file viaggia. Dal 2026-09-23 uno scatto non si
// perde più se la rete cade: il file resta sul tablet (coda dei caricamenti, `upload-queue.ts`) e
// riparte da solo quando la connessione torna, e il riquadro dice in che stato è — in viaggio, in
// attesa di rete, rifiutato dal server (allora: «Riprova» o «Scarta»). Finché resta qualcosa da
// caricare il check-in non si chiude: una foto che sembra esserci ma non è sul server è peggio di
// nessuna foto. Tutti i bersagli sono almeno 44 px: si usa in piedi, con i guanti.
import { useEffect, useRef, useState } from 'react';
import type { MediaCategory } from '@/domain/entities/media-asset';
import { ApiError, type InspectionPhoto } from '@/lib/api-client/client';
import { cn } from '@/lib/utils/cn';
import type { PendingUpload } from './upload-queue';
import { previewUrlFor } from './upload-store';
import { useUploadQueue } from './useUploadQueue';

export interface PhotoCaptureProps {
  readonly appointmentId: string;
  readonly media: readonly InspectionPhoto[];
  readonly onUploaded: (media: InspectionPhoto) => void;
  /**
   * Elimina una foto o un video acquisiti per sbaglio. C'è solo finché il check-in è aperto: dopo,
   * il fascicolo è sigillato e il pulsante non compare. Un tocco solo, senza conferma — il costo
   * dell'errore è rifare uno scatto, e si corregge mentre si è ancora davanti al veicolo.
   */
  readonly onRemove?: ((mediaId: string) => Promise<void>) | undefined;
}

/**
 * Tipi video per gli input: prima quelli espliciti dell'iPad (mp4, QuickTime), poi il jolly per
 * gli altri dispositivi. Il server accetta comunque solo i contenitori che riconosce dai byte.
 */
const VIDEO_ACCEPT = 'video/mp4,video/quicktime,video/*';

export function PhotoCapture({ appointmentId, media, onUploaded, onRemove }: PhotoCaptureProps) {
  const inputRefs = useRef(new Map<string, HTMLInputElement | null>());
  const uploads = useUploadQueue(appointmentId, onUploaded);
  const [errore, setErrore] = useState<string | null>(null);
  /** Media di cui è in corso l'eliminazione: il suo pulsante resta spento finché non finisce. */
  const [inEliminazione, setInEliminazione] = useState<string | null>(null);

  const rimuovi = async (m: InspectionPhoto): Promise<void> => {
    if (onRemove === undefined) {
      return;
    }
    setErrore(null);
    setInEliminazione(m.id);
    try {
      await onRemove(m.id);
    } catch (cause) {
      setErrore(
        cause instanceof ApiError
          ? cause.message
          : `${m.kind === 'VIDEO' ? 'Video' : 'Foto'} non eliminat${m.kind === 'VIDEO' ? 'o' : 'a'}: riprova.`,
      );
    } finally {
      setInEliminazione(null);
    }
  };

  /** Il pulsante «×» in alto a destra di un riquadro: 44 px, si tocca con i guanti. */
  const pulsanteElimina = (m: InspectionPhoto, etichetta: string): React.ReactNode =>
    onRemove === undefined || m.archivedAt !== null ? null : (
      <button
        type="button"
        onClick={() => void rimuovi(m)}
        disabled={inEliminazione === m.id}
        data-testid={`elimina-media-${m.id}`}
        aria-label={etichetta}
        className="premibile focus-anello bg-surface text-ink border-line absolute top-2 right-2 z-10 flex size-11 items-center justify-center rounded-full border shadow-sm disabled:opacity-50"
      >
        <span aria-hidden="true" className="text-2xl leading-none">
          ×
        </span>
      </button>
    );

  // L'orologio del «riprovo tra N s»: gira solo finché qualcosa aspetta la rete.
  const [adesso, setAdesso] = useState(() => Date.now());
  const inAttesaDiRete = uploads.pending.some(
    (u) => u.status === 'WAITING_NETWORK' || u.status === 'WAITING_AUTH',
  );
  useEffect(() => {
    if (!inAttesaDiRete) {
      return undefined;
    }
    const t = setInterval(() => setAdesso(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [inAttesaDiRete]);

  /** Il file entra nella coda del tablet (e da lì parte): da questo momento non si perde più. */
  const onFile = async (
    file: File,
    category: MediaCategory | null,
    kind: 'PHOTO' | 'VIDEO',
  ): Promise<void> => {
    setErrore(null);
    try {
      await uploads.enqueue({ blob: file, fileName: file.name, category, kind });
    } catch {
      setErrore(
        `${kind === 'VIDEO' ? 'Video' : 'Foto'} non acquisit${kind === 'VIDEO' ? 'o' : 'a'}: riprova lo scatto.`,
      );
    }
  };

  /**
   * Input nascosto per uno slot o per i pulsanti liberi; la chiave lo distingue. Con `capture` il
   * tablet apre direttamente la fotocamera posteriore; senza, iOS propone rullino, fotocamera o
   * file: è la via per caricare una ripresa fatta prima, o con un altro dispositivo.
   */
  const inputNascosto = (
    key: string,
    accept: string,
    onPick: (file: File) => void,
    capture = true,
  ): React.ReactNode => (
    <input
      ref={(el) => {
        inputRefs.current.set(key, el);
      }}
      type="file"
      accept={accept}
      {...(capture ? { capture: 'environment' as const } : {})}
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
  const videoInCoda = uploads.pending.some((u) => u.kind === 'VIDEO');

  /** Dal rullino può arrivare una foto o un video: lo dice il file, la casella non c'è. */
  const dalRullino = (file: File): void => {
    const kind = file.type.startsWith('video/') ? 'VIDEO' : 'PHOTO';
    void onFile(file, kind === 'VIDEO' ? null : 'EXTRA', kind);
  };

  /** Un riquadro della riga: stessa misura per il video, per le foto e per il «più». */
  const RIQUADRO =
    'relative flex aspect-square w-40 shrink-0 flex-col justify-end overflow-hidden rounded-2xl border-[3px] text-left';

  return (
    <section className="flex flex-col gap-5">
      {errore !== null ? (
        <p
          role="alert"
          className="bg-status-no-show-soft border-status-no-show/30 text-status-no-show-ink rounded-2xl border-2 px-5 py-4 text-lg font-semibold"
        >
          {errore}
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-bold">Documentazione del veicolo</h2>
          <div className="flex flex-wrap items-center gap-3">
            {/*
             * La via secondaria: la fotocamera resta l'azione principale (i riquadri), ma un video
             * girato prima, o arrivato da un collega, si carica da qui senza `capture`.
             */}
            <button
              type="button"
              onClick={() => inputRefs.current.get('GALLERIA')?.click()}
              data-testid="dal-rullino"
              className="premibile focus-anello controllo border-line bg-surface text-ink-soft hover:bg-surface-sunken inline-flex items-center gap-2 rounded-xl border px-4 font-semibold"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="size-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <circle cx="8.5" cy="10" r="1.5" />
                <path d="m21 16-5-5-9 8" />
              </svg>
              Galleria
            </button>
            {uploads.pending.length > 0 ? (
              <span
                className="bg-status-info-soft text-status-info-ink testo-corpo rounded-full px-4 py-1.5 font-bold"
                data-testid="caricamenti-in-attesa"
                aria-live="polite"
              >
                {uploads.pending.length === 1
                  ? '1 file in attesa di caricamento'
                  : `${uploads.pending.length} file in attesa di caricamento`}
              </span>
            ) : null}
            {video.length === 0 && videoInCoda ? (
              <span className="bg-status-in-progress-soft text-status-in-progress-ink testo-corpo rounded-full px-4 py-1.5 font-bold">
                Video in caricamento — attendi prima di chiudere
              </span>
            ) : video.length === 0 ? (
              <span className="bg-status-in-progress-soft text-status-in-progress-ink testo-corpo rounded-full px-4 py-1.5 font-bold">
                Manca il video — non si può chiudere
              </span>
            ) : (
              <span className="bg-status-completed-soft text-status-completed-ink testo-corpo rounded-full px-4 py-1.5 font-bold">
                ✓ Video registrato — si può chiudere
              </span>
            )}
          </div>
        </div>

        {/*
         * Una riga sola, e il video per primo perché è l'unica cosa obbligatoria. Prima erano sei
         * riquadri con i nomi delle parti — frontale, posteriore, fiancate — che suggerivano un
         * giro ordinato: bello in teoria, ma in officina il giro lo si fa come capita e quei nomi
         * diventavano sei caselle da riempire, cioè sei modi di sentirsi in difetto.
         */}
        <ul className="flex snap-x gap-3 overflow-x-auto pb-2">
          {/*
           * Il comando «Giro del veicolo» esiste solo finché il video manca. Registrato, sparisce:
           * al suo posto restano i riquadri dei video, ciascuno con il suo «×» per rifarlo, e
           * «+ Aggiungi video» per un secondo giro. Prima il riquadro diventava verde ma restava
           * un pulsante, e un tocco ci caricava un altro video sopra: due cose nello stesso posto.
           */}
          {video.length === 0 ? (
            <li className="snap-start">
              <button
                type="button"
                onClick={() => inputRefs.current.get('VIDEO')?.click()}
                data-testid="registra-video"
                aria-label="Registra il video del veicolo (obbligatorio)"
                className={cn(
                  RIQUADRO,
                  'premibile focus-anello border-status-in-progress bg-status-in-progress-soft',
                )}
              >
                <span
                  className="flex flex-1 items-center justify-center text-4xl"
                  aria-hidden="true"
                >
                  ▶
                </span>
                <span className="bg-surface/80 flex flex-col gap-0.5 px-3 py-2">
                  <span className="testo-corpo font-bold">Giro del veicolo</span>
                  <span className="text-ink-muted testo-nota">
                    obbligatorio · tocca per registrare
                  </span>
                </span>
              </button>
            </li>
          ) : null}

          {/*
           * Ogni video ha il suo riquadro, con il suo «×». Prima si vedeva solo l'ultimo, dentro il
           * riquadro del comando: il secondo video registrato spariva dalla vista e non si poteva
           * togliere — e il video del veicolo sbagliato non deve restare nel fascicolo.
           */}
          {video.map((v, i) => (
            <li key={v.id} className="relative snap-start">
              {pulsanteElimina(v, `Elimina il video ${i + 1}`)}
              <span
                className={cn(RIQUADRO, 'border-line bg-ink text-white')}
                data-testid={`video-${i + 1}`}
              >
                <span
                  className="flex flex-1 items-center justify-center text-4xl"
                  aria-hidden="true"
                >
                  ▶
                </span>
                <span className="bg-surface/90 text-ink flex flex-col gap-0.5 px-3 py-2">
                  <span className="testo-corpo font-bold">Video {i + 1}</span>
                  <span className="text-ink-muted testo-nota">
                    {v.archivedAt !== null
                      ? 'file archiviato'
                      : `alle ${new Date(v.capturedAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`}
                  </span>
                </span>
              </span>
            </li>
          ))}

          {foto.map((f) => (
            <li key={f.id} className="relative snap-start">
              {pulsanteElimina(f, 'Elimina questa foto')}
              <span className={cn(RIQUADRO, 'border-line bg-slate-100')}>
                {f.archivedAt !== null ? (
                  <span className="text-ink-muted flex flex-1 items-center justify-center px-2 text-center text-xs">
                    file archiviato
                  </span>
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={f.url}
                    alt="Foto del veicolo"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                )}
              </span>
            </li>
          ))}

          {uploads.pending.map((u) => (
            <li key={u.id} className="snap-start">
              <RiquadroInAttesa
                upload={u}
                adesso={adesso}
                classeRiquadro={RIQUADRO}
                onRetry={() => uploads.retryNow(u.id)}
                onDiscard={() => void uploads.discard(u.id)}
              />
            </li>
          ))}

          <li className="snap-start">
            <button
              type="button"
              onClick={() => inputRefs.current.get('EXTRA')?.click()}
              data-testid="aggiungi-foto"
              aria-label="Aggiungi una foto del veicolo"
              className={cn(
                RIQUADRO,
                'premibile focus-anello border-line bg-surface items-center justify-center border-dashed',
              )}
            >
              <span className="flex flex-1 flex-col items-center justify-center gap-1">
                <span aria-hidden="true" className="text-4xl leading-none">
                  +
                </span>
                <span className="testo-corpo font-bold">Aggiungi foto</span>
                <span className="text-ink-muted testo-nota">facoltative</span>
              </span>
            </button>
          </li>

          {/*
           * «Aggiungi video» compare solo dal secondo in poi: il primo si registra dal riquadro
           * «Giro del veicolo», che è il passaggio obbligatorio e non va sdoppiato. Un giro in più,
           * il dettaglio di un danno ripreso da vicino: stessa forma di «Aggiungi foto».
           */}
          {video.length > 0 ? (
            <li className="snap-start">
              <button
                type="button"
                onClick={() => inputRefs.current.get('VIDEO')?.click()}
                data-testid="aggiungi-video"
                aria-label="Aggiungi un altro video del veicolo"
                className={cn(
                  RIQUADRO,
                  'premibile focus-anello border-line bg-surface items-center justify-center border-dashed',
                )}
              >
                <span className="flex flex-1 flex-col items-center justify-center gap-1">
                  <span aria-hidden="true" className="text-4xl leading-none">
                    +
                  </span>
                  <span className="testo-corpo font-bold">Aggiungi video</span>
                  <span className="text-ink-muted testo-nota">un altro giro o un dettaglio</span>
                </span>
              </button>
            </li>
          ) : null}
        </ul>
        {inputNascosto('EXTRA', 'image/*', (file) => void onFile(file, 'EXTRA', 'PHOTO'))}
        {/*
         * Il client non ridimensiona né ricodifica nulla: il file parte com'è, entro gli 80 MB.
         * Quello che comprime è iOS quando registra dal browser; la via per la qualità nativa
         * (4K, 60 fps) è l'app Fotocamera più «Galleria», e la riga qui sotto lo ricorda.
         */}
        {inputNascosto('VIDEO', VIDEO_ACCEPT, (file) => void onFile(file, null, 'VIDEO'))}
        {inputNascosto('GALLERIA', `image/*,${VIDEO_ACCEPT}`, dalRullino, false)}
        {uploads.pending.length > 0 ? (
          <p className="text-ink-soft testo-nota" data-testid="nota-caricamenti">
            {uploads.persistent
              ? 'I file in attesa restano salvati sul tablet anche senza rete o chiudendo la pagina: partono da soli appena la connessione torna.'
              : 'I file in attesa partono da soli appena la connessione torna: tieni aperta questa pagina finché non sono caricati.'}
          </p>
        ) : null}
        <p className="text-ink-muted testo-nota" data-testid="nota-qualita-video">
          Per la massima qualità (4K, 60 fps) registra il video con l&apos;app Fotocamera
          dell&apos;iPad e caricalo da «Galleria»: il file arriva com&apos;è, senza ricompressione.
        </p>
      </div>
    </section>
  );
}

interface RiquadroInAttesaProps {
  readonly upload: PendingUpload;
  /** Millisecondi epoch, per il conto alla rovescia del prossimo tentativo. */
  readonly adesso: number;
  readonly classeRiquadro: string;
  readonly onRetry: () => void;
  readonly onDiscard: () => void;
}

/**
 * Un file acquisito e non ancora sul server: l'anteprima dal file locale e, sopra, lo stato in
 * parole. È sempre vero: «in attesa di rete» vuol dire che riparte da solo, «non salvata» vuol dire
 * che il server l'ha rifiutata e serve una decisione.
 */
function RiquadroInAttesa({
  upload,
  adesso,
  classeRiquadro,
  onRetry,
  onDiscard,
}: RiquadroInAttesaProps) {
  const anteprima = upload.kind === 'PHOTO' ? previewUrlFor(upload) : null;
  const percentuale = Math.round(upload.progress * 100);
  const secondi =
    upload.nextAttemptAt === null
      ? 0
      : Math.max(0, Math.ceil((upload.nextAttemptAt - adesso) / 1_000));
  const nome = upload.kind === 'VIDEO' ? 'Video' : 'Foto';

  return (
    <span
      className={cn(
        classeRiquadro,
        upload.status === 'FAILED'
          ? 'border-status-no-show bg-status-no-show-soft'
          : 'border-status-info bg-surface-sunken',
      )}
      data-testid={`in-attesa-${upload.id}`}
      aria-label={`${nome} in attesa di caricamento`}
    >
      {anteprima !== null ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={anteprima}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-40"
        />
      ) : (
        <span
          className="text-ink-muted absolute inset-0 flex items-center justify-center text-4xl"
          aria-hidden="true"
        >
          ▶
        </span>
      )}
      <span className="bg-surface/90 text-ink relative flex flex-col gap-1 px-3 py-2">
        {upload.status === 'UPLOADING' ? (
          <>
            <span className="testo-corpo font-bold">Caricamento {percentuale}%</span>
            <span className="bg-line-subtle block h-2 overflow-hidden rounded-full">
              <span
                className="bg-status-info block h-full rounded-full"
                style={{ width: `${percentuale}%` }}
              />
            </span>
          </>
        ) : upload.status === 'QUEUED' ? (
          <span className="testo-corpo font-bold">{nome} in coda…</span>
        ) : upload.status === 'WAITING_NETWORK' ? (
          <>
            <span className="testo-corpo font-bold">In attesa di rete</span>
            <span className="text-ink-soft testo-nota">
              {secondi > 0 ? `riprovo tra ${secondi} s` : 'riprovo adesso…'}
            </span>
            <button
              type="button"
              onClick={onRetry}
              className="premibile focus-anello controllo border-line bg-surface testo-nota rounded-lg border px-2 font-semibold"
            >
              Riprova ora
            </button>
          </>
        ) : upload.status === 'WAITING_AUTH' ? (
          <span className="testo-nota font-semibold">
            Sessione scaduta: accedi di nuovo, il file resta sul tablet.
          </span>
        ) : (
          <>
            <span className="text-status-no-show-ink testo-corpo font-bold">
              {nome} non salvat{upload.kind === 'VIDEO' ? 'o' : 'a'}
            </span>
            {upload.lastError !== null ? (
              <span className="text-ink-soft testo-nota line-clamp-2">{upload.lastError}</span>
            ) : null}
            <span className="flex gap-1">
              <button
                type="button"
                onClick={onRetry}
                className="premibile focus-anello controllo border-line bg-surface testo-nota flex-1 rounded-lg border px-2 font-semibold"
              >
                Riprova
              </button>
              <button
                type="button"
                onClick={onDiscard}
                className="premibile focus-anello controllo border-line bg-surface text-status-no-show-ink testo-nota flex-1 rounded-lg border px-2 font-semibold"
              >
                Scarta
              </button>
            </span>
          </>
        )}
      </span>
    </span>
  );
}
