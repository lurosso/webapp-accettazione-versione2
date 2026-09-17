'use client';

// Tabella della coda con tre sezioni: In carico (in alto), In coda (attesa + saltate per orario) e
// Chiuse oggi (completate, no-show, annullate; collassabile).
import { useState } from 'react';
import {
  compareQueueOrder,
  effectiveScheduleTime,
  isDueWithinGrace,
  isLate,
} from '@/domain/entities/appointment';
import type { Brand } from '@/domain/entities/brand';
import { LATE_GRACE_MINUTES } from '@/config/constants';
import { cn } from '@/lib/utils/cn';
import type { Desk } from '@/domain/entities/desk';
import type { QueueRowView } from '@/domain/read-models';
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
  /** Istante del server: decide chi è in ritardo, senza fidarsi dell'orologio del client. */
  readonly serverTime: string;
  readonly pendingId: string | null;
  readonly currentOperatorName: string;
  readonly onAction: (
    appointmentId: string,
    action: AppointmentAction,
    expectedVersion: number,
  ) => void;
  readonly onSelect: (row: QueueRowView) => void;
  /** Pratica aperta nel pannello di dettaglio: la riga resta evidenziata. */
  readonly selectedId?: string | null;
  /** Monitoraggio in sola lettura: nessuna azione sulle righe. */
  readonly readOnly?: boolean;
}

interface Section {
  readonly key: string;
  readonly title: string;
  readonly rows: readonly QueueRowView[];
  readonly collapsible: boolean;
  /** Testo mostrato quando la sezione è vuota. */
  readonly emptyLabel: string;
  /** Nota sotto il titolo: spiega cosa fare con le pratiche di questo blocco. */
  readonly hint?: string;
  /** Sezione dei clienti in ritardo: righe evidenziate e azioni dedicate. */
  readonly late?: boolean;
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
  serverTime,
  pendingId,
  currentOperatorName,
  onAction,
  onSelect,
  selectedId = null,
  readOnly = false,
}: QueueTableProps) {
  const [closedOpen, setClosedOpen] = useState(false);

  /** Ordina per orario effettivo: una pratica rimessa in coda si ricolloca al nuovo orario. */
  const byTime = (list: readonly QueueRowView[]): QueueRowView[] =>
    [...list].sort((x, y) => compareQueueOrder(x.appointment, y.appointment));

  /** Minuti trascorsi dall'orario in cui la pratica era attesa. */
  const lateBy = (row: QueueRowView): number =>
    Math.max(
      0,
      Math.floor(
        (new Date(serverTime).getTime() -
          new Date(effectiveScheduleTime(row.appointment)).getTime()) /
          60_000,
      ),
    );

  const inProgress = byTime(rows.filter((r) => r.appointment.status === 'IN_PROGRESS'));
  const inQueue = rows.filter(
    (r) => r.appointment.status === 'WAITING' || r.appointment.status === 'SKIPPED',
  );
  // Chi era atteso prima di adesso e non è stato preso in carico finisce nel blocco dei ritardi:
  // sono le pratiche su cui l'accettatore deve decidere qualcosa, non quelle che stanno aspettando.
  const late = byTime(inQueue.filter((r) => isLate(r.appointment, serverTime, LATE_GRACE_MINUTES)));
  const queued = byTime(
    inQueue.filter((r) => !isLate(r.appointment, serverTime, LATE_GRACE_MINUTES)),
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
      emptyLabel: 'Nessuna pratica in lavorazione.',
    },
    {
      key: 'queued',
      title: `In coda (${queued.length})`,
      rows: queued,
      collapsible: false,
      emptyLabel: 'Nessuna pratica in coda.',
    },
    {
      key: 'late',
      title: `In ritardo / assenti (${late.length})`,
      rows: late,
      collapsible: false,
      late: true,
      hint: `Attesi da oltre ${LATE_GRACE_MINUTES} minuti e non ancora presi in carico: rimettili in coda quando arrivano, oppure segnalali assenti per il ricontatto.`,
      emptyLabel: 'Nessun cliente in ritardo.',
    },
    {
      key: 'closed',
      title: `Chiuse oggi (${closed.length})`,
      rows: closed,
      collapsible: true,
      emptyLabel: 'Nessuna pratica chiusa.',
    },
  ];

  const brandName = (brandId: string): string =>
    brands.find((b) => b.id === brandId)?.name ?? brandId;

  return (
    <div className="flex flex-col gap-8">
      {sections.map((section) => {
        const hidden = section.collapsible && !closedOpen;
        return (
          <section key={section.key} aria-labelledby={`section-${section.key}`}>
            <div className="mb-3 flex items-start justify-between gap-4">
              <div>
                <h2
                  id={`section-${section.key}`}
                  className={cn(
                    'text-sm font-semibold tracking-wide uppercase',
                    section.late === true ? 'text-priority-late-ink' : 'text-ink-soft',
                  )}
                >
                  {section.title}
                </h2>
                {section.hint !== undefined && section.rows.length > 0 ? (
                  <p className="text-ink-muted mt-1 text-xs">{section.hint}</p>
                ) : null}
              </div>
              {section.collapsible ? (
                <Button
                  variant="ghost"
                  size="touch"
                  onClick={() => setClosedOpen((v) => !v)}
                  aria-expanded={!hidden}
                >
                  {hidden ? 'Mostra' : 'Nascondi'}
                </Button>
              ) : null}
            </div>
            {hidden ? null : section.rows.length === 0 ? (
              <p className="border-line bg-surface text-ink-muted rounded-lg border border-dashed px-5 py-4 text-sm">
                {section.emptyLabel}
              </p>
            ) : (
              <div
                className={cn(
                  'bg-surface rounded-lg border shadow-sm',
                  section.late === true ? 'border-priority-late-line' : 'border-line-subtle',
                )}
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Codice</TableHead>
                      <TableHead>Orario</TableHead>
                      <TableHead>Targa</TableHead>
                      <TableHead>Veicolo</TableHead>
                      <TableHead>Cliente</TableHead>
                      {showDesk ? <TableHead>Sportello</TableHead> : null}
                      <TableHead>Stato</TableHead>
                      {/* Campata e operatore si leggono nel dettaglio: su un iPad occupavano
                          spazio per mostrare due trattini, e lo toglievano ai comandi. Tornano
                          dal monitor del banco in poi. */}
                      <TableHead className="hidden xl:table-cell">Accettazione</TableHead>
                      <TableHead className="hidden xl:table-cell">Operatore</TableHead>
                      {/* Larghezza propria: senza, i comandi si impilavano uno sotto l'altro e la
                          riga cresceva fino a duecento pixel. */}
                      <TableHead className="w-[23rem] text-right">Azioni</TableHead>
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
                          dueSoon={
                            section.late !== true &&
                            isDueWithinGrace(row.appointment, serverTime, LATE_GRACE_MINUTES)
                          }
                          deskLabel={desk === null ? null : `${desk.code} · ${desk.name}`}
                          showDesk={showDesk}
                          foreignDesk={foreignDesk}
                          timeZone={timeZone}
                          pending={pendingId === row.appointment.id}
                          currentOperatorName={currentOperatorName}
                          late={section.late === true}
                          lateByMinutes={section.late === true ? lateBy(row) : 0}
                          selected={row.appointment.id === selectedId}
                          readOnly={readOnly}
                          onAction={(action) =>
                            onAction(row.appointment.id, action, row.appointment.version)
                          }
                          onSelect={() => onSelect(row)}
                        />
                      );
                    })}
                  </TableBody>
                </Table>
                <p className="text-ink-muted px-3 py-2 text-xs">
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
