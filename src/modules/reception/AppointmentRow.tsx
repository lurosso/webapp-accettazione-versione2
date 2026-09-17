'use client';

// Riga della coda: codice in evidenza, orario, targa, veicolo, cliente, sportello (vista globale),
// stato, campata, operatore e azioni. Evidenze: In carico giallo, Completata verde, Saltata arancio.
// L'intera riga apre il dettaglio della pratica; il codice è anche un pulsante, così il pannello
// si raggiunge da tastiera e con gli screen reader, non solo col mouse.
import {
  effectiveScheduleTime,
  isAutoClosedPending,
  isInQueue,
  type AppointmentStatus,
} from '@/domain/entities/appointment';
import type { QueueRowView } from '@/domain/read-models';
import { Badge } from '@/components/ui/badge';
import { OperatorChip } from '@/components/shared/OperatorChip';
import { TableCell, TableRow } from '@/components/ui/table';
import { localTimeHHmm } from '@/lib/dates';
import { cn } from '@/lib/utils/cn';
import { ActionButtons } from './ActionButtons';
import { StatusBadge } from './StatusBadge';
import type { AppointmentAction } from './types';

export interface AppointmentRowProps {
  readonly row: QueueRowView;
  readonly brandName: string;
  readonly deskLabel: string | null;
  readonly showDesk: boolean;
  readonly foreignDesk: boolean;
  readonly timeZone: string;
  readonly pending: boolean;
  /** Nome dell'operatore collegato: marca con "(tu)" le pratiche prese in carico da lui. */
  readonly currentOperatorName: string;
  /** Riga del blocco "in ritardo": aggiunge le azioni per gestire il ritardo. */
  readonly late?: boolean;
  /** Minuti di ritardo accumulati, mostrati accanto all'orario. */
  readonly lateByMinutes?: number;
  /** Orario atteso superato ma entro la tolleranza: riga gialla, "da servire ora". */
  readonly dueSoon?: boolean;
  readonly onAction: (action: AppointmentAction) => void;
  readonly onSelect: () => void;
  /** Riga aperta nel pannello di dettaglio. */
  readonly selected?: boolean;
}

const ROW_CLASSES: Partial<Record<AppointmentStatus, string>> = {
  IN_PROGRESS: 'bg-status-in-progress-soft',
  SKIPPED: 'bg-status-skipped-soft',
  COMPLETED: 'bg-status-completed-soft',
  NO_SHOW: 'bg-status-no-show-soft',
  CANCELLED: 'bg-status-cancelled-soft text-slate-500',
};

export function AppointmentRow({
  row,
  brandName,
  deskLabel,
  showDesk,
  foreignDesk,
  timeZone,
  pending,
  currentOperatorName,
  late = false,
  lateByMinutes = 0,
  dueSoon = false,
  onAction,
  onSelect,
  selected = false,
}: AppointmentRowProps) {
  const a = row.appointment;
  // Il cliente ha avvisato dal portale che arriva in ritardo: avviso ambra finché è in coda.
  const avvisoRitardo = a.customerLateNoticeAt !== null && isInQueue(a.status);
  return (
    <TableRow
      className={cn(
        // Riga interamente toccabile: sul tablet si apre il dettaglio con il dito, senza mirare
        // il codice. `select-none` evita che il tocco prolungato selezioni il testo invece di
        // aprire il pannello.
        'cursor-pointer select-none hover:brightness-[0.97]',
        ROW_CLASSES[a.status],
        dueSoon && 'bg-amber-100/80',
        avvisoRitardo && !dueSoon && 'bg-amber-50',
        pending && 'opacity-60',
        selected && 'ring-brand-secondary/70 ring-2 ring-inset',
      )}
      aria-selected={selected}
      data-status={a.status}
      onClick={onSelect}
    >
      <TableCell className="font-mono text-base font-bold tracking-wide">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
          className="-mx-2 inline-flex min-h-11 items-center rounded px-2 underline decoration-slate-400 decoration-dotted underline-offset-4 hover:decoration-slate-900 focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:outline-none"
          aria-label={`Apri i dettagli della pratica ${a.code}, ${a.vehicle.plate}`}
        >
          {a.code}
        </button>
        {a.source === 'MANUAL' ? (
          <Badge tone="info" className="ml-2 align-middle">
            Manuale
          </Badge>
        ) : null}
      </TableCell>
      <TableCell className="font-mono tabular-nums">
        {localTimeHHmm(new Date(effectiveScheduleTime(a)), timeZone)}
        {a.rescheduledAt !== null ? (
          <span
            className="block text-xs font-normal text-slate-500"
            title={`Orario in agenda: ${localTimeHHmm(new Date(a.scheduledAt), timeZone)}`}
          >
            rimessa in coda
          </span>
        ) : null}
        {dueSoon ? (
          <span className="block text-xs font-semibold text-amber-800">orario superato</span>
        ) : null}
        {avvisoRitardo ? (
          <span
            className="block text-xs font-semibold text-amber-800"
            title={`Avviso dal portale alle ${localTimeHHmm(new Date(a.customerLateNoticeAt ?? a.updatedAt), timeZone)}`}
          >
            cliente in ritardo · arrivo ~
            {a.customerEtaAt === null ? '?' : localTimeHHmm(new Date(a.customerEtaAt), timeZone)}
          </span>
        ) : null}
        {late && lateByMinutes > 0 ? (
          <span className="block text-xs font-semibold text-red-700">
            {lateByMinutes < 60
              ? `+${lateByMinutes} min`
              : `+${Math.floor(lateByMinutes / 60)} h ${lateByMinutes % 60} min`}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="font-mono font-semibold">{a.vehicle.plate}</TableCell>
      <TableCell>
        <span className="font-medium">{brandName}</span>
        <span className="text-slate-500"> {a.vehicle.model}</span>
      </TableCell>
      {/* Colonna volutamente essenziale: l'esito del contatto sta nel pannello di dettaglio,
          dove l'accettatore lo cerca quando deve chiamare il cliente. */}
      <TableCell>
        {a.customer.lastName} {a.customer.firstName}
        {/* La lavorazione arriva da Infinity e può essere lunghissima: due righe in tabella, il
            resto nel pannello di dettaglio. Senza limite una sola riga occupava mezzo schermo di
            tablet e spingeva fuori vista tutte le altre pratiche. Niente `block` accanto a
            `line-clamp-2`: sovrascriverebbe il display -webkit-box che fa il troncamento. */}
        {a.serviceDescription !== null ? (
          <span className="line-clamp-2 text-xs text-slate-500" title={a.serviceDescription}>
            {a.serviceDescription}
          </span>
        ) : null}
      </TableCell>
      {showDesk ? (
        <TableCell>
          <span className={cn(foreignDesk && 'text-slate-500')}>{deskLabel ?? 'n/d'}</span>
        </TableCell>
      ) : null}
      <TableCell>
        <StatusBadge status={a.status} />
        {isAutoClosedPending(a) ? (
          <span className="mt-0.5 block text-xs font-semibold text-amber-800">
            chiusa d&apos;ufficio · da confermare
          </span>
        ) : null}
        {a.skipCount > 0 ? (
          // "In attesa ×1" si leggeva come un conteggio dello stato: meglio dire cosa è successo.
          <span className="mt-0.5 block text-xs text-slate-500">
            {a.skipCount === 1 ? 'saltata 1 volta' : `saltata ${a.skipCount} volte`}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="hidden font-mono lg:table-cell">
        {row.bayCode ?? (a.status === 'IN_PROGRESS' ? 'senza' : '—')}
      </TableCell>
      <TableCell className="hidden lg:table-cell">
        {row.operatorName === null ? (
          <span className="text-slate-400">—</span>
        ) : (
          <OperatorChip
            displayName={row.operatorName}
            isCurrent={row.operatorName === currentOperatorName}
          />
        )}
      </TableCell>
      <TableCell>
        {/* I pulsanti non devono aprire il pannello: l'azione è già esplicita. */}
        <div onClick={(event) => event.stopPropagation()}>
          <ActionButtons
            appointment={a}
            pending={pending}
            foreignDesk={foreignDesk}
            late={late}
            onAction={onAction}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}
