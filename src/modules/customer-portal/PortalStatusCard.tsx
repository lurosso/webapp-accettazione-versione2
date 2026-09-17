// Schermata di stato del cliente (mobile-first, brandizzata Autoclub): codice e targa in grande,
// barra di avanzamento a quattro tappe, messaggio di cortesia, clienti prima di te, riquadro con
// orario previsto, accettatore e sede. Pensata per essere letta al volo su smartphone.
import type { PortalStatusView } from '@/domain/read-models';
import { localTimeHHmm } from '@/lib/dates';
import { cn } from '@/lib/utils/cn';
import { ProgressSteps } from './ProgressSteps';
import { aheadCountMessage, stageLabel, statusMessage, type StatusTone } from './status-messages';

export interface PortalStatusCardProps {
  readonly position: PortalStatusView;
  readonly timeZone: string;
  /** Istante dell'ultimo aggiornamento riuscito (per la riga "aggiornato alle …"). */
  readonly updatedAtMs: number;
  /** True mentre il polling sta riprovando dopo un errore: lo stato mostrato è l'ultimo noto. */
  readonly stale: boolean;
  /** Pulsante "Sto arrivando in ritardo" (o la sua conferma), quando ha senso. */
  readonly action?: React.ReactNode;
}

const TONE_CARD: Record<StatusTone, string> = {
  waiting: 'border-slate-200 bg-white',
  serving: 'border-brand-secondary bg-sky-50',
  done: 'border-brand-primary bg-status-completed-soft',
  attention: 'border-red-300 bg-status-no-show-soft',
};

const TONE_CODE: Record<StatusTone, string> = {
  waiting: 'text-brand-blue-dark',
  serving: 'text-brand-secondary',
  done: 'text-emerald-900',
  attention: 'text-red-900',
};

function InfoItem({
  label,
  value,
  mono = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl bg-white/70 px-3 py-2 ring-1 ring-slate-200">
      <dt className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className={cn('text-base font-semibold text-slate-900', mono && 'font-mono')}>{value}</dd>
    </div>
  );
}

export function PortalStatusCard({
  position,
  timeZone,
  updatedAtMs,
  stale,
  action,
}: PortalStatusCardProps) {
  const message = statusMessage(position.status, position.bayCode);
  const orario = localTimeHHmm(new Date(position.expectedTime), timeZone);
  const orarioAgenda = localTimeHHmm(new Date(position.scheduledAt), timeZone);

  return (
    <section
      aria-labelledby="stato-titolo"
      data-testid="portal-status"
      data-status={position.status}
      className={cn(
        'flex flex-col gap-6 rounded-3xl border-2 p-5 shadow-sm sm:p-7',
        TONE_CARD[message.tone],
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Il tuo codice
          </p>
          <p
            className={cn(
              'font-mono text-6xl leading-none font-black tracking-wider tabular-nums sm:text-7xl',
              TONE_CODE[message.tone],
            )}
          >
            {position.code}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          <span className="rounded-md border-2 border-slate-900 bg-white px-2 py-0.5 font-mono text-xl font-bold tracking-widest text-slate-900">
            {position.plate}
          </span>
          <span className="text-xs text-slate-500">{stageLabel(position.stage)}</span>
        </div>
      </div>

      <ProgressSteps stage={position.stage} tone={message.tone} />

      <div className="flex flex-col items-center gap-2 text-center" aria-live="polite">
        <h1 id="stato-titolo" className="text-3xl font-bold text-slate-900">
          {message.headline}
        </h1>
        {message.showAheadCount ? (
          <p className="text-2xl font-semibold text-slate-900" data-testid="ahead-count">
            {aheadCountMessage(position.aheadCount)}
          </p>
        ) : null}
        <p className="text-lg text-slate-700">{message.detail}</p>
      </div>

      <dl className="grid grid-cols-2 gap-2">
        <InfoItem
          label="Orario previsto"
          value={orario === orarioAgenda ? orario : `${orario} (agenda ${orarioAgenda})`}
          mono
        />
        <InfoItem label="Codice in coda" value={position.code} mono />
        <InfoItem label="Targa" value={position.plate} mono />
        <InfoItem
          label="Accettatore"
          value={
            position.operatorName ??
            (position.status === 'IN_PROGRESS' ? 'in corsia' : 'da assegnare')
          }
        />
        <div className="col-span-2">
          <InfoItem
            label="Sede"
            value={[position.siteName, position.deskName].filter((x) => x !== null).join(' · ')}
          />
        </div>
      </dl>

      {action}

      <p className="text-center text-sm text-slate-500">
        {stale
          ? 'Connessione lenta: stiamo riprovando, questo è l’ultimo stato ricevuto.'
          : `Aggiornato automaticamente alle ${localTimeHHmm(new Date(updatedAtMs), timeZone)}`}
      </p>
    </section>
  );
}
