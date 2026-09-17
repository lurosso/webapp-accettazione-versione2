'use client';

// Schermata di check-in del veicolo, a tutto schermo sul tablet. Pensata per chi la usa in piedi,
// con i guanti sporchi e il sole sullo schermo:
// - in alto, fissi, codice e targa grandi con cliente e veicolo: si riconosce l'auto senza leggere;
// - al centro la documentazione del veicolo (foto a slot, "+ Foto", video) e le note;
// - in basso, fissi e a portata di pollice, i due soli comandi: "Completa check-in" (verde: fa
//   avanzare la pratica) e "Salta per ora" (grigio: si esce senza perdere nulla).
// Il VIDEO del veicolo è obbligatorio e finché manca il pulsante verde resta spento, con scritto
// perché; le foto restano facoltative. Prima di chiudere davvero si passa da una conferma: su un
// tablet tenuto in mano un tocco involontario non deve concludere un'accettazione.
// Testi grandi, bordi spessi, contrasto alto, niente stati che dipendono dal passaggio del mouse.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import type { QueueRowView } from '@/domain/read-models';
import {
  ApiError,
  fetchInspectionPhotos,
  postCheckIn,
  type InspectionPhoto,
} from '@/lib/api-client/client';
import { queueKeys } from '@/lib/api-client/query-keys';
import { localTimeHHmm } from '@/lib/dates';
import { cn } from '@/lib/utils/cn';
import { PhotoCapture } from './PhotoCapture';

export interface CheckInScreenProps {
  readonly row: QueueRowView;
  readonly brandName: string;
  readonly timeZone: string;
  readonly onClose: () => void;
  /**
   * Uscita senza concludere ("Salta per ora"): la pratica resta in carico e il check-in si
   * riprende dopo. Serve quando piove o bisogna spostare la vettura subito.
   */
  readonly onSkip?: (() => void) | undefined;
  readonly onCompleted: (codice: string, foto: number) => void;
}

/** Annotazioni frequenti: un tocco al posto di scrivere con i guanti. */
const NOTE_RAPIDE: readonly string[] = [
  'Graffio',
  'Ammaccatura',
  'Cristallo scheggiato',
  'Cerchio rigato',
  'Spia accesa',
  'Carburante basso',
];

export function CheckInScreen({
  row,
  brandName,
  timeZone,
  onClose,
  onSkip,
  onCompleted,
}: CheckInScreenProps) {
  const esci = onSkip ?? onClose;
  const a = row.appointment;
  const queryClient = useQueryClient();
  const [media, setMedia] = useState<readonly InspectionPhoto[]>([]);
  const [note, setNote] = useState(a.notes ?? '');
  const [inChiusura, setInChiusura] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  // Doppio controllo prima di chiudere: il tablet si tiene in mano e si tocca per sbaglio.
  const [confermaAperta, setConfermaAperta] = useState(false);

  // Media già acquisiti: riaprendo il check-in si ritrova quanto fatto prima.
  useEffect(() => {
    let attivo = true;
    fetchInspectionPhotos(a.id)
      .then((r) => {
        if (attivo) {
          setMedia(r.photos);
        }
      })
      .catch(() => {
        // L'elenco è un di più: se non arriva, si può comunque scattare e concludere.
      });
    return () => {
      attivo = false;
    };
  }, [a.id]);

  const foto = media.filter((m) => m.kind !== 'VIDEO').length;
  const video = media.filter((m) => m.kind === 'VIDEO').length;
  // Unico requisito: la ripresa del veicolo. Senza, il pulsante verde non si accende.
  const videoMancante = video === 0;

  const completa = async (): Promise<void> => {
    setErrore(null);
    setConfermaAperta(false);
    setInChiusura(true);
    try {
      const esito = await postCheckIn(a.id, {
        expectedVersion: a.version,
        inspectionNotes: note.trim() === '' ? null : note.trim(),
      });
      await queryClient.invalidateQueries({ queryKey: queueKeys.all });
      onCompleted(esito.appointment.code, esito.photoCount + esito.videoCount);
    } catch (cause) {
      setErrore(
        cause instanceof ApiError
          ? cause.message
          : 'Non è stato possibile concludere il check-in. Riprova.',
      );
      setInChiusura(false);
    }
  };

  /** Aggiunge un'annotazione rapida senza duplicarla. */
  const aggiungiNota = (testo: string): void => {
    setNote((corrente) => {
      if (corrente.split(/\s*[·\n]\s*/).some((parte) => parte.trim() === testo)) {
        return corrente;
      }
      return corrente.trim() === '' ? testo : `${corrente.trim()} · ${testo}`;
    });
  };

  const riepilogoMedia = videoMancante
    ? 'Registra il video del veicolo: è l’unico passaggio obbligatorio. Le foto restano facoltative.'
    : `${foto} foto e ${video} video nel fascicolo. Tutto pronto: la pratica si chiude e lo sportello si libera.`;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-100 text-slate-900">
      {/* Testata fissa: codice e targa si leggono da un metro, il resto è di supporto. */}
      <header className="border-brand-secondary shrink-0 border-b-4 bg-white">
        <div className="mx-auto flex w-full max-w-4xl items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={esci}
            disabled={inChiusura}
            aria-label="Torna alla coda senza concludere"
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border-2 border-slate-300 bg-white text-3xl leading-none font-bold text-slate-700 active:bg-slate-100 disabled:opacity-60"
          >
            ‹
          </button>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-4xl leading-none font-black tracking-wide">
                {a.code}
              </span>
              <span className="rounded-md border-2 border-slate-900 bg-white px-2 py-0.5 font-mono text-2xl leading-none font-bold tracking-widest">
                {a.vehicle.plate}
              </span>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="truncate text-xl font-semibold">
                {a.customer.lastName} {a.customer.firstName}
              </span>
              <span className="text-lg text-slate-600">
                {brandName} {a.vehicle.model}
              </span>
              <span className="text-base text-slate-500">
                ore {localTimeHHmm(new Date(a.scheduledAt), timeZone)}
                {a.serviceDescription !== null ? ` · ${a.serviceDescription}` : ''}
              </span>
            </div>
          </div>
          {/* Contatore dei media: le foto informano, il video dice se si può chiudere. */}
          <div
            className="flex shrink-0 flex-col items-end gap-0.5 text-right"
            aria-label={`${foto} foto e ${video} video acquisiti${videoMancante ? '; il video è obbligatorio' : ''}`}
          >
            <span className="font-mono text-2xl leading-none font-black tabular-nums">
              {foto}
              <span className="text-base font-semibold text-slate-500"> foto</span>
            </span>
            <span
              className={cn(
                'font-mono text-xl leading-none font-black tabular-nums',
                videoMancante ? 'text-amber-700' : 'text-status-completed',
              )}
            >
              {video}
              <span className="text-sm font-semibold"> video</span>
            </span>
            {videoMancante ? (
              <span className="text-xs font-bold tracking-wide text-amber-700 uppercase">
                obbligatorio
              </span>
            ) : null}
          </div>
        </div>
      </header>

      {/* Corpo scorrevole: documentazione e note. Il resto della schermata non si muove. */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-5 pb-8">
          {errore !== null ? (
            <p
              role="alert"
              className="bg-status-no-show-soft rounded-2xl border-2 border-red-200 px-5 py-4 text-lg font-semibold text-red-900"
            >
              {errore}
            </p>
          ) : null}

          <PhotoCapture
            appointmentId={a.id}
            media={media}
            onUploaded={(m) => setMedia((precedenti) => [...precedenti, m])}
          />

          <section className="flex flex-col gap-3 rounded-2xl border-2 border-slate-200 bg-white p-4">
            <label htmlFor="note-veicolo" className="text-xl font-bold">
              Note veicolo / danni rilevati
            </label>
            <div className="flex flex-wrap gap-2" aria-label="Annotazioni rapide">
              {NOTE_RAPIDE.map((testo) => (
                <button
                  key={testo}
                  type="button"
                  onClick={() => aggiungiNota(testo)}
                  className="min-h-12 rounded-full border-2 border-slate-300 bg-slate-50 px-4 text-base font-semibold text-slate-800 active:bg-slate-200"
                >
                  + {testo}
                </button>
              ))}
            </div>
            <textarea
              id="note-veicolo"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Es. graffio sul paraurti posteriore destro, cerchio anteriore sinistro rigato."
              className="placeholder:text-ink-muted w-full rounded-xl border-2 border-slate-300 bg-white p-4 text-xl leading-snug text-slate-900 focus-visible:border-slate-900 focus-visible:ring-4 focus-visible:ring-slate-300 focus-visible:outline-none"
            />
            <p className="text-sm text-slate-500">
              Quanto scrivi qui resta sulla pratica e viene inviato al CRM insieme a foto e video.
            </p>
          </section>
        </div>
      </main>

      {/* Comandi fissi in basso, a portata di pollice; il bordo inferiore rispetta la tacca dei tablet. */}
      <footer className="shrink-0 border-t-2 border-slate-200 bg-white px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-2">
          <div className="flex gap-3">
            <button
              type="button"
              onClick={esci}
              disabled={inChiusura}
              className="flex h-16 flex-1 flex-col items-center justify-center rounded-2xl border-2 border-slate-300 bg-slate-100 text-lg leading-tight font-bold text-slate-800 active:bg-slate-200 disabled:opacity-60"
            >
              Salta per ora
              <span className="text-xs font-medium text-slate-500">torna alla coda</span>
            </button>
            <button
              type="button"
              onClick={() => setConfermaAperta(true)}
              disabled={inChiusura || videoMancante}
              aria-describedby="stato-check-in"
              data-testid="completa-check-in"
              className={cn(
                'bg-brand-primary focus-visible:ring-brand-lime-dark active:bg-brand-lime-dark flex h-16 flex-[2] items-center justify-center rounded-2xl text-xl font-bold text-slate-950 shadow-sm focus-visible:ring-4 focus-visible:outline-none active:text-white',
                // Spento finché manca il video: grigio, non verde sbiadito, così si vede da lontano
                // che non è un pulsante in attesa ma un passaggio che manca.
                videoMancante && !inChiusura && 'bg-slate-300 text-slate-600 shadow-none',
                'disabled:cursor-not-allowed disabled:opacity-80',
              )}
            >
              {inChiusura ? 'Conclusione in corso…' : 'Completa check-in'}
            </button>
          </div>
          <p
            id="stato-check-in"
            className={cn(
              'text-center text-base font-semibold',
              videoMancante ? 'text-amber-800' : 'text-status-completed',
            )}
          >
            {riepilogoMedia}
          </p>
        </div>
      </footer>

      {/* Doppio controllo: una schermata a parte, con due bersagli lontani fra loro. */}
      <Dialog
        open={confermaAperta}
        title="Completare il check-in?"
        description={`Pratica ${a.code} · ${a.vehicle.plate}. La pratica si chiude, lo sportello si libera e il fascicolo parte verso il CRM.`}
        onClose={() => setConfermaAperta(false)}
        className="max-w-xl"
        footer={
          <div className="flex w-full flex-col-reverse gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => setConfermaAperta(false)}
              className="min-h-14 flex-1 rounded-2xl border-2 border-slate-300 bg-white text-lg font-bold text-slate-800 active:bg-slate-100"
            >
              Annulla
            </button>
            <button
              type="button"
              onClick={() => void completa()}
              data-testid="conferma-check-in"
              className="bg-brand-primary active:bg-brand-lime-dark min-h-14 flex-[2] rounded-2xl text-lg font-bold text-slate-950 shadow-sm active:text-white"
            >
              Sì, completa
            </button>
          </div>
        }
      >
        <p className="text-lg text-slate-800">
          Nel fascicolo ci sono <strong>{foto} foto</strong> e <strong>{video} video</strong>.
        </p>
        {note.trim() !== '' ? (
          <p className="mt-2 rounded-xl bg-slate-50 px-4 py-3 text-base whitespace-pre-wrap text-slate-700">
            {note.trim()}
          </p>
        ) : (
          <p className="mt-2 text-base text-slate-500">Nessuna nota sul veicolo.</p>
        )}
      </Dialog>
    </div>
  );
}
