'use client';

// Tabella della coda con tre sezioni: In carico (in alto), In coda (attesa + saltate per orario) e
// Chiuse oggi (completate, no-show, annullate; collassabile).
import { useState } from 'react';
import type { Brand } from '@/domain/entities/brand';
import type { Desk } from '@/domain/entities/desk';
import type { QueueRowView } from '@/domain/read-models';
import { compareByScheduleThenSequence } from '@/domain/value-objects/queue-code';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AppointmentRow } from './AppointmentRow';
import type { AppointmentAction } from './types';

export interface QueueTableProps {
  readonly rows: readonly QueueRowView[];
  readonly brands: readonly Brand[];
  readonly desks: readonly Desk[];
  /** Sportello dell'operatore: le pratiche di altri sportelli sono evidenziate in vista globale. */
  readonly homeDeskId: string | null;
  readonly showDesk: boolean;
  readonly timeZone: string;
  readonly pendingId: string | null;
  readonly currentOperatorName: string;
  readonly onAction: (
    appointmentId: string,
    action: AppointmentAction,
    expectedVersion: number,
  ) => void;
  readonly onSelect: (row: QueueRowView) => void;
}

interface Section {
  readonly key: string;
  readonly title: string;
  readonly rows: readonly QueueRowView[];
  readonly collapsible: boolean;
}

/** Sportello di appartenenza: esplicito oppure dedotto dal marchio. */
export function deskOf(row: QueueRowView, desks: readonly Desk[]): Desk | null {
  const a = row.appointment;
  if (a.deskId !== null) {
    return desks.find((d) => d.id === a.deskId) ?? null;
  }
  return desks.find((d) => d.brandIds.includes(a.brandId)) ?? null;
}

export function QueueTable({
  rows,
  brands,
  desks,
  homeDeskId,
  showDesk,
  timeZone,
  pendingId,
  currentOperatorName,
  onAction,
  onSelect,
}: QueueTableProps) {
  const [closedOpen, setClosedOpen] = useState(false);

  const byTime = (list: readonly QueueRowView[]): QueueRowView[] =>
    [...list].sort((x, y) => compareByScheduleThenSequence(x.appointment, y.appointment));

  const inProgress = byTime(rows.filter((r) => r.appointment.status === 'IN_PROGRESS'));
  const queued = byTime(
    rows.filter((r) => r.appointment.status === 'WAITING' || r.appointment.status === 'SKIPPED'),
  );
  const closed = byTime(
    rows.filter((r) => ['COMPLETED', 'NO_SHOW', 'CANCELLED'].includes(r.appointment.status)),
  );

  const sections: Section[] = [
    {
      key: 'in-progress',
      title: `In carico (${inProgress.length})`,
      rows: inProgress,
      collapsible: false,
    },
    { key: 'queued', title: `In coda (${queued.length})`, rows: queued, collapsible: false },
    { key: 'closed', title: `Chiuse oggi (${closed.length})`, rows: closed, collapsible: true },
  ];

  const brandName = (brandId: string): string =>
    brands.find((b) => b.id === brandId)?.name ?? brandId;

  return (
    <div className="flex flex-col gap-6">
      {sections.map((section) => {
        const hidden = section.collapsible && !closedOpen;
        return (
          <section key={section.key} aria-labelledby={`section-${section.key}`}>
            <div className="mb-2 flex items-center justify-between">
              <h2
                id={`section-${section.key}`}
                className="text-sm font-semibold tracking-wide text-slate-600 uppercase"
              >
                {section.title}
              </h2>
              {section.collapsible ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setClosedOpen((v) => !v)}
                  aria-expanded={!hidden}
                >
                  {hidden ? 'Mostra' : 'Nascondi'}
                </Button>
              ) : null}
            </div>
            {hidden ? null : section.rows.length === 0 ? (
              <p className="rounded-md border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500">
                {section.key === 'queued' ? 'Nessuna pratica in coda.' : 'Nessuna pratica.'}
              </p>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pt-3">Codice</TableHead>
                      <TableHead className="pt-3">Orario</TableHead>
                      <TableHead className="pt-3">Targa</TableHead>
                      <TableHead className="pt-3">Veicolo</TableHead>
                      <TableHead className="pt-3">Cliente</TableHead>
                      {showDesk ? <TableHead className="pt-3">Sportello</TableHead> : null}
                      <TableHead className="pt-3">Stato</TableHead>
                      <TableHead className="pt-3">Campata</TableHead>
                      <TableHead className="pt-3">Operatore</TableHead>
                      <TableHead className="pt-3">Azioni</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {section.rows.map((row) => {
                      const desk = deskOf(row, desks);
                      const foreignDesk =
                        showDesk && homeDeskId !== null && desk !== null && desk.id !== homeDeskId;
                      return (
                        <AppointmentRow
                          key={row.appointment.id}
                          row={row}
                          brandName={brandName(row.appointment.brandId)}
                          deskLabel={desk === null ? null : `${desk.code} · ${desk.name}`}
                          showDesk={showDesk}
                          foreignDesk={foreignDesk}
                          timeZone={timeZone}
                          pending={pendingId === row.appointment.id}
                          currentOperatorName={currentOperatorName}
                          onAction={(action) =>
                            onAction(row.appointment.id, action, row.appointment.version)
                          }
                          onSelect={() => onSelect(row)}
                        />
                      );
                    })}
                  </TableBody>
                </Table>
                <p className="px-3 py-2 text-xs text-slate-400">
                  {section.rows.length} {section.rows.length === 1 ? 'pratica' : 'pratiche'} ·
                  clicca una riga per i dettagli del cliente
                </p>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
