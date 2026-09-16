'use client';

// Scheda «Riconsegne»: le commesse in consegna oggi (righe `L` del planning di Infinity, flusso
// RETURN), tenute fuori dalla coda dell'accettazione. Una riga per veicolo, in ordine di ora
// prevista: codice R001…, targa, veicolo, cliente, commessa e stato in officina. La sync la aggiorna
// da sola: quando Infinity la segna consegnata la riga diventa «Riconsegnata».
import { effectiveScheduleTime } from '@/domain/entities/appointment';
import type { Brand } from '@/domain/entities/brand';
import { customerFullName } from '@/domain/entities/customer';
import type { QueueRowView } from '@/domain/read-models';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { localTimeHHmm } from '@/lib/dates';
import { cn } from '@/lib/utils/cn';

export interface ReturnsTableProps {
  readonly rows: readonly QueueRowView[];
  readonly brands: readonly Brand[];
  readonly timeZone: string;
  /** Istante del server: una riconsegna prevista già passata e non fatta si evidenzia. */
  readonly serverTime: string;
}

const STATO_RICONSEGNA: Readonly<
  Record<string, { readonly label: string; readonly tone: BadgeTone }>
> = {
  WAITING: { label: 'Da riconsegnare', tone: 'info' },
  SKIPPED: { label: 'Rinviata', tone: 'neutral' },
  IN_PROGRESS: { label: 'In consegna', tone: 'warning' },
  COMPLETED: { label: 'Riconsegnata', tone: 'success' },
  NO_SHOW: { label: 'Non ritirata', tone: 'danger' },
  CANCELLED: { label: 'Annullata', tone: 'neutral' },
};

export function ReturnsTable({ rows, brands, timeZone, serverTime }: ReturnsTableProps) {
  const ordinate = [...rows].sort((x, y) =>
    effectiveScheduleTime(x.appointment).localeCompare(effectiveScheduleTime(y.appointment)),
  );
  const brandName = (brandId: string): string =>
    brands.find((b) => b.id === brandId)?.name ?? brandId;
  const adesso = new Date(serverTime).getTime();

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Codice</TableHead>
          <TableHead>Ora</TableHead>
          <TableHead>Targa</TableHead>
          <TableHead>Veicolo e cliente</TableHead>
          <TableHead>Commessa e stato</TableHead>
          <TableHead>Riconsegna</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ordinate.map((row) => {
          const a = row.appointment;
          const stato = STATO_RICONSEGNA[a.status] ?? { label: a.status, tone: 'neutral' as const };
          const inRitardo =
            a.status === 'WAITING' && new Date(effectiveScheduleTime(a)).getTime() < adesso;
          return (
            <TableRow
              key={a.id}
              className={cn('min-h-12', inRitardo ? 'bg-amber-50' : undefined)}
              data-testid="riga-riconsegna"
            >
              <TableCell className="font-mono text-lg font-black">{a.code}</TableCell>
              <TableCell className="font-mono tabular-nums">
                {localTimeHHmm(new Date(effectiveScheduleTime(a)), timeZone)}
                {inRitardo ? (
                  <span className="block text-xs font-semibold text-amber-800">
                    oltre l&apos;ora
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="font-mono font-bold">{a.vehicle.plate}</TableCell>
              <TableCell className="max-w-64">
                <div className="leading-tight">
                  {brandName(a.brandId)} {a.vehicle.model}
                </div>
                <div className="text-xs text-slate-600">{customerFullName(a.customer)}</div>
              </TableCell>
              <TableCell className="max-w-56">
                <div className="font-mono text-sm">{a.workOrderRef ?? '—'}</div>
                <div className="text-xs text-slate-600">{a.serviceDescription ?? '—'}</div>
              </TableCell>
              <TableCell>
                <Badge tone={stato.tone}>{stato.label}</Badge>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
