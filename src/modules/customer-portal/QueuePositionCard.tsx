// Schermata di stato del cliente: codice di prenotazione in grande, clienti in attesa e
// messaggio di cortesia reattivo allo stato. Pensata per essere letta da lontano su smartphone.
import type { QueuePositionView } from '@/domain/read-models';
import { localTimeHHmm } from '@/lib/dates';
import { cn } from '@/lib/utils/cn';
import { aheadCountMessage, statusMessage, type StatusTone } from './status-messages';

export interface QueuePositionCardProps {
  readonly position: QueuePositionView;
  readonly timeZone: string;
  /** Istante dell'ultimo aggiornamento riuscito (per la riga "aggiornato alle …"). */
  readonly updatedAtMs: number;
  /** True mentre il polling sta riprovando dopo un errore: lo stato mostrato è l'ultimo noto. */
  readonly stale: boolean;
}

const TONE_CARD: Record<StatusTone, string> = {
  waiting: 'border-slate-200 bg-white',
  serving: 'border-amber-400 bg-status-in-progress-soft',
  done: 'border-emerald-300 bg-status-completed-soft',
  attention: 'border-red-300 bg-status-no-show-soft',
};

const TONE_CODE: Record<StatusTone, string> = {
  waiting: 'text-slate-900',
  serving: 'text-amber-900',
  done: 'text-emerald-900',
  attention: 'text-red-900',
};

export function QueuePositionCard({
  position,
  timeZone,
  updatedAtMs,
  stale,
}: QueuePositionCardProps) {
  const message = statusMessage(position.status, position.bayNumber);

  return (
    <section
      aria-labelledby="stato-titolo"
      className={cn(
        'flex flex-col gap-6 rounded-2xl border-2 p-6 shadow-sm',
        TONE_CARD[message.tone],
      )}
    >
      <div className="flex flex-col items-center gap-1">
        <p className="text-base font-medium tracking-wide text-slate-600 uppercase">
          Il tuo codice
        </p>
        <p
          className={cn(
            'font-mono text-7xl font-black tracking-wider tabular-nums',
            TONE_CODE[message.tone],
          )}
        >
          {position.code}
        </p>
        <p className="text-base text-slate-600">
          Appuntamento delle {localTimeHHmm(new Date(position.scheduledAt), timeZone)}
        </p>
      </div>

      <div className="flex flex-col items-center gap-2 text-center" aria-live="polite">
        <h1 id="stato-titolo" className="text-3xl font-bold text-slate-900">
          {message.headline}
        </h1>
        {message.showAheadCount ? (
          <p className="text-2xl font-semibold text-slate-900">
            {aheadCountMessage(position.aheadCount)}
          </p>
        ) : null}
        <p className="text-lg text-slate-700">{message.detail}</p>
      </div>

      <p className="text-center text-sm text-slate-500">
        {stale
          ? 'Connessione lenta: stiamo riprovando, questo è l’ultimo stato ricevuto.'
          : `Aggiornato automaticamente alle ${localTimeHHmm(new Date(updatedAtMs), timeZone)}`}
      </p>
    </section>
  );
}
