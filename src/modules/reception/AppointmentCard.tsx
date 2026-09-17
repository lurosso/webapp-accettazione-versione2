'use client';

// La stessa pratica della riga di tabella, ma in forma di scheda: è quello che vede chi ha il
// tablet in mano.
//
// Non è la tabella con più aria: una tabella a dieci colonne su un iPad costringe a leggere in
// orizzontale una riga alla volta, ed è il modo peggiore di usare uno schermo che si tiene
// inclinato. Qui l'occhio scende: codice e orario a sinistra, targa e cliente al centro, lo stato
// e i comandi a destra. Si vedono quattro o cinque pratiche invece di nove, ed è un prezzo che al
// banco non pagheremmo — infatti al banco resta la tabella (vedi `QueueTable`).
//
// L'area d'identità è un vero `<button>` e non tutta la scheda: i comandi stanno accanto, e due
// elementi interattivi annidati sono un guaio sia per la tastiera sia per il dito.
import {
  effectiveScheduleTime,
  isAutoClosedPending,
  isInQueue,
  type AppointmentStatus,
} from '@/domain/entities/appointment';
import type { QueueRowView } from '@/domain/read-models';
import { Badge } from '@/components/ui/badge';
import { localTimeHHmm } from '@/lib/dates';
import { cn } from '@/lib/utils/cn';
import { ActionButtons } from './ActionButtons';
import { StatusBadge } from './StatusBadge';
import type { AppointmentAction } from './types';

export interface AppointmentCardProps {
  readonly row: QueueRowView;
  readonly brandName: string;
  readonly deskLabel: string | null;
  readonly showDesk: boolean;
  readonly foreignDesk: boolean;
  readonly timeZone: string;
  readonly pending: boolean;
  readonly late?: boolean;
  readonly lateByMinutes?: number;
  readonly dueSoon?: boolean;
  readonly selected?: boolean;
  readonly readOnly?: boolean;
  readonly onAction: (action: AppointmentAction) => void;
  readonly onSelect: () => void;
}

/** Come sopra in tabella: il fondo dice la priorità, mai lo stato. */
const STATO_SPENTO: Partial<Record<AppointmentStatus, string>> = {
  CANCELLED: 'text-ink-muted',
};

export function AppointmentCard({
  row,
  brandName,
  deskLabel,
  showDesk,
  foreignDesk,
  timeZone,
  pending,
  late = false,
  lateByMinutes = 0,
  dueSoon = false,
  selected = false,
  readOnly = false,
  onAction,
  onSelect,
}: AppointmentCardProps) {
  const a = row.appointment;
  const avvisoRitardo = a.customerLateNoticeAt !== null && isInQueue(a.status);
  const inFila = a.customerArrivedAt !== null && isInQueue(a.status);

  return (
    <li
      data-status={a.status}
      className={cn(
        'transizione flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4',
        STATO_SPENTO[a.status],
        dueSoon && !late && 'bg-priority-now-soft',
        pending && 'opacity-60',
        selected && 'ring-brand-secondary bg-surface-sunken ring-2 ring-inset',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-label={`Apri i dettagli della pratica ${a.code}, ${a.vehicle.plate}`}
        className="focus-anello -mx-2 flex min-w-0 flex-1 items-center gap-5 rounded-md px-2 py-1 text-left select-none"
      >
        <span className="flex min-w-[5.5rem] flex-col gap-0.5">
          <span className="testo-codice font-mono font-bold tracking-wide">{a.code}</span>
          <span className="text-ink-soft font-mono text-xs tabular-nums">
            {localTimeHHmm(new Date(effectiveScheduleTime(a)), timeZone)}
          </span>
          {late && lateByMinutes > 0 ? (
            <span className="text-priority-late-ink text-xs font-semibold whitespace-nowrap">
              {lateByMinutes < 60
                ? `+${lateByMinutes} min`
                : `+${Math.floor(lateByMinutes / 60)} h ${lateByMinutes % 60} min`}
            </span>
          ) : null}
          {dueSoon && !late ? (
            <span className="text-priority-now-ink text-xs font-semibold">orario superato</span>
          ) : null}
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="testo-dato font-mono font-semibold tracking-wide">
              {a.vehicle.plate}
            </span>
            <span className="testo-corpo">
              <span className="font-semibold">{brandName}</span>{' '}
              <span className="text-ink-soft">{a.vehicle.model}</span>
            </span>
            {a.source === 'MANUAL' ? <Badge tone="info">Manuale</Badge> : null}
          </span>
          <span className="testo-corpo text-ink-soft">
            {a.customer.lastName} {a.customer.firstName}
          </span>
          {/* La lavorazione arriva da Infinity e può essere lunghissima: una riga sola qui, il
              resto nel pannello di dettaglio, che è dove la si legge davvero. */}
          {a.serviceDescription !== null ? (
            <span className="text-ink-muted testo-nota line-clamp-1" title={a.serviceDescription}>
              {a.serviceDescription}
            </span>
          ) : null}
          {inFila ? (
            <span
              className="text-status-completed-ink testo-nota font-semibold"
              data-testid="cliente-in-fila"
            >
              in fila dalle {localTimeHHmm(new Date(a.customerArrivedAt ?? a.updatedAt), timeZone)}
            </span>
          ) : null}
          {avvisoRitardo ? (
            <span className="text-priority-now-ink testo-nota font-semibold">
              cliente in ritardo · arrivo ~
              {a.customerEtaAt === null ? '?' : localTimeHHmm(new Date(a.customerEtaAt), timeZone)}
            </span>
          ) : null}
        </span>
      </button>

      <span className="flex flex-col items-start gap-1">
        <StatusBadge status={a.status} />
        {showDesk && deskLabel !== null ? (
          <span className={cn('testo-nota', foreignDesk ? 'text-ink-muted' : 'text-ink-soft')}>
            {deskLabel}
          </span>
        ) : null}
        {isAutoClosedPending(a) ? (
          <span className="text-priority-now-ink testo-nota font-semibold">da confermare</span>
        ) : null}
      </span>

      {readOnly ? (
        <span className="text-ink-muted testo-nota">sola lettura</span>
      ) : (
        <ActionButtons
          appointment={a}
          pending={pending}
          foreignDesk={foreignDesk}
          late={late}
          onAction={onAction}
        />
      )}
    </li>
  );
}
