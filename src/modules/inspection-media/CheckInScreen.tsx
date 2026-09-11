'use client';

// Schermata di accettazione al veicolo, a tutto schermo sul tablet: l'accettatore è in piedi
// accanto all'auto, quindi comandi grandi, poche cose per volta e nessuna finestra da chiudere.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { QueueRowView } from '@/domain/read-models';
import {
  PHOTO_CATEGORY_LABELS,
  REQUIRED_PHOTO_CATEGORIES,
  type MediaCategory,
} from '@/domain/entities/media-asset';
import {
  ApiError,
  fetchInspectionPhotos,
  postCheckIn,
  type InspectionPhoto,
} from '@/lib/api-client/client';
import { queueKeys } from '@/lib/api-client/query-keys';
import { localTimeHHmm } from '@/lib/dates';
import { PhotoCapture } from './PhotoCapture';

export interface CheckInScreenProps {
  readonly row: QueueRowView;
  readonly brandName: string;
  readonly timeZone: string;
  readonly onClose: () => void;
  readonly onCompleted: (codice: string, foto: number) => void;
}

export function CheckInScreen({
  row,
  brandName,
  timeZone,
  onClose,
  onCompleted,
}: CheckInScreenProps) {
  const a = row.appointment;
  const queryClient = useQueryClient();
  const [photos, setPhotos] = useState<readonly InspectionPhoto[]>([]);
  const [note, setNote] = useState(a.notes ?? '');
  const [inChiusura, setInChiusura] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  // Foto già acquisite: riaprendo il check-in si ritrova quanto fatto prima.
  useEffect(() => {
    let attivo = true;
    fetchInspectionPhotos(a.id)
      .then((r) => {
        if (attivo) {
          setPhotos(r.photos);
        }
      })
      .catch(() => {
        // L'elenco è un di più: se non arriva, si può comunque scattare e concludere.
      });
    return () => {
      attivo = false;
    };
  }, [a.id]);

  // Riprese obbligatorie ancora da fare: la stessa regola vale sul server, qui serve a non far
  // arrivare l'accettatore in fondo alla scheda per sentirsi dire che manca una foto.
  const mancanti: readonly MediaCategory[] = REQUIRED_PHOTO_CATEGORIES.filter(
    (categoria) => !photos.some((p) => p.category === categoria),
  );

  const completa = async (): Promise<void> => {
    setErrore(null);
    setInChiusura(true);
    try {
      const esito = await postCheckIn(a.id, {
        expectedVersion: a.version,
        inspectionNotes: note.trim() === '' ? null : note.trim(),
      });
      await queryClient.invalidateQueries({ queryKey: queueKeys.all });
      onCompleted(esito.appointment.code, esito.photoCount);
    } catch (cause) {
      setErrore(
        cause instanceof ApiError
          ? cause.message
          : 'Non è stato possibile concludere il check-in. Riprova.',
      );
      setInChiusura(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-3xl font-black tracking-wide">{a.code}</span>
            <span className="font-mono text-xl font-bold text-slate-700">{a.vehicle.plate}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-touch rounded-xl border-2 border-slate-300 bg-white px-5 text-base font-semibold text-slate-700 hover:bg-slate-100"
          >
            Chiudi
          </button>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-8 px-5 py-6">
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h1 className="text-2xl font-bold text-slate-900">Accettazione al veicolo</h1>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-base">
            <div>
              <dt className="text-sm text-slate-500">Cliente</dt>
              <dd className="font-semibold">
                {a.customer.lastName} {a.customer.firstName}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-slate-500">Veicolo</dt>
              <dd className="font-semibold">
                {brandName} {a.vehicle.model}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-slate-500">Appuntamento</dt>
              <dd className="font-semibold">{localTimeHHmm(new Date(a.scheduledAt), timeZone)}</dd>
            </div>
            <div>
              <dt className="text-sm text-slate-500">Lavorazione</dt>
              <dd className="font-semibold">{a.serviceDescription ?? 'Non indicata'}</dd>
            </div>
          </dl>
        </section>

        <PhotoCapture
          appointmentId={a.id}
          photos={photos}
          missing={mancanti}
          onUploaded={(p) => setPhotos((precedenti) => [...precedenti, p])}
        />

        <section className="flex flex-col gap-2">
          <label htmlFor="note-veicolo" className="text-xl font-bold text-slate-900">
            Note veicolo / danni rilevati
          </label>
          <textarea
            id="note-veicolo"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={6}
            maxLength={2000}
            placeholder="Es. graffio sul paraurti posteriore destro, cerchio anteriore sinistro rigato, livello carburante basso."
            className="w-full rounded-xl border-2 border-slate-300 bg-white p-4 text-lg text-slate-900 shadow-sm placeholder:text-slate-400 focus-visible:border-slate-900 focus-visible:ring-4 focus-visible:ring-slate-300 focus-visible:outline-none"
          />
          <p className="text-sm text-slate-500">
            Quanto scrivi qui resta sulla pratica e viene inviato al CRM insieme alle foto.
          </p>
        </section>

        {errore !== null ? (
          <p
            role="alert"
            className="bg-status-no-show-soft rounded-lg px-4 py-3 text-base text-red-900"
          >
            {errore}
          </p>
        ) : null}

        <div className="sticky bottom-0 -mx-5 border-t border-slate-200 bg-white px-5 py-4">
          <button
            type="button"
            onClick={() => void completa()}
            disabled={inChiusura || mancanti.length > 0}
            aria-describedby={mancanti.length > 0 ? 'foto-mancanti' : undefined}
            className="bg-status-completed h-16 w-full rounded-xl text-xl font-bold text-white shadow-sm hover:brightness-95 focus-visible:ring-4 focus-visible:ring-emerald-300 focus-visible:outline-none disabled:opacity-60"
          >
            {inChiusura ? 'Conclusione in corso…' : 'Completa check-in'}
          </button>
          {mancanti.length > 0 ? (
            <p
              id="foto-mancanti"
              className="bg-status-in-progress-soft mt-2 rounded-lg px-4 py-2 text-center text-base font-semibold text-amber-900"
            >
              Prima di concludere mancano:{' '}
              {mancanti.map((categoria) => PHOTO_CATEGORY_LABELS[categoria]).join(', ')}.
            </p>
          ) : (
            <p className="mt-2 text-center text-sm text-slate-500">
              La pratica viene chiusa, l&apos;accettazione si libera e il cliente successivo può
              avanzare.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
