'use client';

// Riga della coda: codice in evidenza, orario, targa, veicolo, cliente, sportello (vista globale),
// stato, campata, operatore e azioni. Evidenze: In carico giallo, Completata verde, Saltata arancio.
import type { AppointmentStatus } from '@/domain/entities/appointment';
import type { QueueRowView } from '@/domain/read-models';
import { Badge } from '@/components/ui/badge';
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
  readonly onAction: (action: AppointmentAction) => void;
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
  onAction,
}: AppointmentRowProps) {
  const a = row.appointment;
  return (
    <TableRow className={cn(ROW_CLASSES[a.status], pending && 'opacity-60')} data-status={a.status}>
      <TableCell className="font-mono text-base font-bold tracking-wide">
        {a.code}
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
        {a.customer.lastName} {a.customer.firstName}
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
          <span className="ml-2 text-xs text-slate-500" title="Numero di salti">
            ×{a.skipCount}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="font-mono">
        {row.bayCode ?? (a.status === 'IN_PROGRESS' ? 'senza' : '—')}
      </TableCell>
      <TableCell className="text-slate-600">{row.operatorName ?? '—'}</TableCell>
      <TableCell>
        <ActionButtons
          appointment={a}
          pending={pending}
          foreignDesk={foreignDesk}
          onAction={onAction}
        />
      </TableCell>
    </TableRow>
  );
}
