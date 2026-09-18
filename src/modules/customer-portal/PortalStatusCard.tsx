// Pagina di tracciamento del cliente (mobile-first, brandizzata Autoclub). È quello che si apre
// dal link WhatsApp dopo aver risposto «Arrivato», e sostituisce il QR da inquadrare in officina.
//
// La gerarchia è pensata per chi aspetta IN AUTO, in fila davanti all'officina, e guarda lo
// schermo per due secondi ogni tanto:
// 1. il codice, perché è quello che sentirà chiamare;
// 2. UN SOLO numero grande al centro, che cambia significato con lo stato: la posizione in fila
//    mentre aspetta, la lettera dello sportello quando tocca a lui. Mai due numeri grandi insieme:
//    davanti a "3" e "B" della stessa dimensione nessuno capisce quale contare;
// 3. la riga del tempo (arrivo registrato, chiamata allo sportello, orario previsto), che risponde
//    alla domanda vera di chi aspetta, "da quanto sono qui e quando tocca a me";
// 4. i dati di contorno e, in fondo, l'unica azione concessa.
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

/*
 * Il colore fa metà del lavoro. In attesa: bianco e blu istituzionale, niente che chieda
 * attenzione, perché non c'è niente da fare. Chiamato: il verde del marchio prende tutta la
 * scheda, con il bordo spesso — da mezzo metro si vede che è cambiato qualcosa prima ancora di
 * mettere a fuoco le parole.
 */
const TONE_CARD: Record<StatusTone, string> = {
  waiting: 'border-slate-200 bg-white',
  serving: 'border-brand-primary bg-brand-primary/15 ring-4 ring-brand-primary/20',
  done: 'border-brand-primary bg-status-completed-soft',
  attention: 'border-status-no-show/40 bg-status-no-show-soft',
};

const TONE_CODE: Record<StatusTone, string> = {
  waiting: 'text-brand-blue-dark',
  serving: 'text-slate-950',
  done: 'text-status-completed-ink',
  attention: 'text-status-no-show-ink',
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

/** Una tappa della riga del tempo: ora grande, etichetta piccola. Assente = non ancora successa. */
function Tappa({
  label,
  time,
  tone = 'neutral',
}: {
  readonly label: string;
  readonly time: string | null;
  readonly tone?: 'neutral' | 'done';
}) {
  return (
    <div
      className={cn(
        'flex flex-1 flex-col items-center gap-0.5 rounded-xl px-2 py-2 text-center',
        tone === 'done' ? 'bg-white ring-1 ring-slate-200' : 'bg-white/60',
      )}
    >
      <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
        {label}
      </span>
      <span
        className={cn(
          'font-mono text-lg font-bold tabular-nums',
          time === null ? 'text-slate-300' : 'text-slate-900',
        )}
      >
        {time ?? '—'}
      </span>
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
  const ora = (iso: string | null): string | null =>
    iso === null ? null : localTimeHHmm(new Date(iso), timeZone);
  const orario = localTimeHHmm(new Date(position.expectedTime), timeZone);
  const orarioAgenda = localTimeHHmm(new Date(position.scheduledAt), timeZone);
  // Il numero grande al centro: la posizione mentre si aspetta, la lettera quando si è chiamati.
  const inFila = position.queuePosition !== null;
  const allosportello = position.status === 'IN_PROGRESS' && position.bayCode !== null;

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
            Il suo codice
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
        <h1
          id="stato-titolo"
          className={cn(
            'font-bold text-slate-900',
            allosportello ? 'text-4xl tracking-tight' : 'text-3xl',
          )}
        >
          {message.headline}
        </h1>

        {allosportello ? (
          // È il suo turno: la lettera dello sportello è la cosa più grande della pagina, su fondo
          // verde e con l'alone che respira. È l'unica cosa che deve cercare mentre avanza.
          <div
            className="chiamata-pulsa bg-brand-primary flex flex-col items-center rounded-3xl px-10 py-4 shadow-lg"
            data-testid="sportello"
          >
            <span className="text-sm font-bold tracking-[0.3em] text-slate-900/70 uppercase">
              Sportello
            </span>
            <span className="text-8xl leading-none font-black text-slate-950">
              {position.bayCode}
            </span>
          </div>
        ) : inFila ? (
          <div className="flex flex-col items-center gap-1" data-testid="posizione">
            <p className="text-2xl font-semibold text-slate-900">
              È il numero{' '}
              <span className="font-mono text-5xl leading-none font-black tabular-nums">
                {position.queuePosition}
              </span>{' '}
              in fila
            </p>
            <p className="text-lg text-slate-600" data-testid="ahead-count">
              {aheadCountMessage(position.aheadCount)}
            </p>
          </div>
        ) : null}

        <p className="text-lg text-slate-700">{message.detail}</p>
      </div>

      {/* Riga del tempo: da quando è qui, da quando è allo sportello, a che ora era atteso. */}
      <div className="flex gap-2" aria-label="Orari della sua accettazione">
        <Tappa
          label="Arrivo"
          time={ora(position.arrivedAt)}
          tone={position.arrivedAt === null ? 'neutral' : 'done'}
        />
        <Tappa
          label="Allo sportello"
          time={ora(position.startedAt)}
          tone={position.startedAt === null ? 'neutral' : 'done'}
        />
        <Tappa label="Orario previsto" time={orario} tone="done" />
      </div>

      <dl className="grid grid-cols-2 gap-2">
        <InfoItem label="Targa" value={position.plate} mono />
        <InfoItem
          label="Accettatore"
          value={
            position.operatorName ??
            (position.status === 'IN_PROGRESS' ? 'allo sportello' : 'da assegnare')
          }
        />
        <div className="col-span-2">
          <InfoItem
            label="Sede"
            value={[position.siteName, position.deskName].filter((x) => x !== null).join(' · ')}
          />
        </div>
      </dl>

      {orario !== orarioAgenda ? (
        <p className="text-center text-sm text-slate-500">
          Orario in agenda {orarioAgenda}, riprogrammato in officina alle {orario}.
        </p>
      ) : null}

      {action}

      <p className="text-center text-sm text-slate-500">
        {stale
          ? 'Connessione lenta: stiamo riprovando, questo è l’ultimo stato ricevuto.'
          : `Aggiornato automaticamente alle ${localTimeHHmm(new Date(updatedAtMs), timeZone)}`}
      </p>
    </section>
  );
}
