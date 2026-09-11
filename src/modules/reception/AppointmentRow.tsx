'use client';

// Riga della coda: codice in evidenza, orario, targa, veicolo, cliente, sportello (vista globale),
// stato, campata, operatore e azioni. Evidenze: In carico giallo, Completata verde, Saltata arancio.
// L'intera riga apre il dettaglio della pratica; il codice è anche un pulsante, così il pannello
// si raggiunge da tastiera e con gli screen reader, non solo col mouse.
import type { AppointmentStatus } from '@/domain/entities/appointment';
import type { QueueRowView } from '@/domain/read-models';
import { Badge } from '@/components/ui/badge';
import { OperatorChip } from '@/components/shared/OperatorChip';
import { TableCell, TableRow } from '@/components/ui/table';
import { localTimeHHmm } from '@/lib/dates';
import { cn } from '@/lib/utils/cn';
import { ActionButtons } from './ActionButtons';
import { NotificationBadge } from './NotificationBadge';
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
  readonly onAction: (action: AppointmentAction) => void;
  readonly onSelect: () => void;
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
  onAction,
  onSelect,
}: AppointmentRowProps) {
  const a = row.appointment;
  return (
    <TableRow
      className={cn(
        'cursor-pointer hover:brightness-[0.97]',
        ROW_CLASSES[a.status],
        pending && 'opacity-60',
      )}
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
          className="rounded underline decoration-slate-400 decoration-dotted underline-offset-4 hover:decoration-slate-900 focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:outline-none"
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
        {localTimeHHmm(new Date(a.scheduledAt), timeZone)}
      </TableCell>
      <TableCell className="font-mono font-semibold">{a.vehicle.plate}</TableCell>
      <TableCell>
        <span className="font-medium">{brandName}</span>
        <span className="text-slate-500"> {a.vehicle.model}</span>
      </TableCell>
      <TableCell>
        <span className="flex flex-wrap items-center gap-1.5">
          <span>
            {a.customer.lastName} {a.customer.firstName}
          </span>
          {/* Se il cliente è già stato avvisato, e con quale canale. */}
          <NotificationBadge status={row.notificationStatus} channel={row.notificationChannel} />
        </span>
        {a.serviceDescription !== null ? (
          <span className="block text-xs text-slate-500">{a.serviceDescription}</span>
        ) : null}
      </TableCell>
      {showDesk ? (
        <TableCell>
          <span className={cn(foreignDesk && 'text-slate-500')}>{deskLabel ?? 'n/d'}</span>
        </TableCell>
      ) : null}
      <TableCell>
        <StatusBadge status={a.status} />
        {a.skipCount > 0 ? (
          // "In attesa ×1" si leggeva come un conteggio dello stato: meglio dire cosa è successo.
          <span className="mt-0.5 block text-xs text-slate-500">
            {a.skipCount === 1 ? 'saltata 1 volta' : `saltata ${a.skipCount} volte`}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="font-mono">
        {row.bayCode ?? (a.status === 'IN_PROGRESS' ? 'senza' : '—')}
      </TableCell>
      <TableCell>
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
            onAction={onAction}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}
