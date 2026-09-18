'use client';

// Tabella della coda con tre sezioni: In carico (in alto), In coda (attesa + saltate per orario) e
// Chiuse oggi (completate, no-show, annullate; collassabile).
import { Fragment, useState } from 'react';
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
import { AppointmentCard } from './AppointmentCard';
import { AppointmentRow } from './AppointmentRow';
import type { AppointmentAction } from './types';

/** Per quanto una pratica resta «appena cambiata»: oltre, il movimento sarebbe un ricordo. */
const FINESTRA_MOVIMENTO_MS = 10_000;

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
  /**
   * La prima riga è la prossima da servire, e si vede da lontano — col dito diventa una scheda a
   * sé sotto «Tocca a lui adesso», al banco resta la prima riga della stessa tabella, in ambra.
   * Sono due modi di dire la stessa cosa: dividerla in due sezioni anche al banco voleva dire due
   * tabelle con la stessa intestazione ripetuta per una riga ciascuna.
   */
  readonly evidenzaPrima?: boolean;
  /** Ridotta a una riga sola finché non la si apre: vale per i ritardi. */
  readonly compatta?: boolean;
  /** Riga compatta: cosa c'è scritto quando la sezione è chiusa. */
  readonly compattaLabel?: (n: number) => string;
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
  const [ritardiAperti, setRitardiAperti] = useState(false);

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

  /*
   * La coda non è un elenco: è una fila. Il primo da servire sta in una scheda sua, grande, e il
   * resto segue in forma compatta — «poi questi». Prima erano tutte righe uguali, e l'accettatore
   * doveva scegliere da solo chi veniva prima, quaranta volte al giorno, con il cliente davanti.
   *
   * I ritardi stanno in una riga sola finché non li si apre. Venti righe rosse in fondo alla coda
   * non sono venti avvisi: sono uno sfondo, e chi le guarda ogni mattina smette di vederle.
   */
  const sections: Section[] = [
    {
      key: 'in-progress',
      title: `In carico · ${inProgress.length}`,
      rows: inProgress,
      collapsible: false,
      emptyLabel: 'Nessuna pratica in lavorazione.',
    },
    {
      key: 'queued',
      title: `In coda · ${queued.length}`,
      rows: queued,
      collapsible: false,
      evidenzaPrima: true,
      emptyLabel: 'Nessuna pratica in coda.',
    },
    {
      key: 'late',
      title: `In ritardo · ${late.length}`,
      rows: late,
      collapsible: false,
      compatta: true,
      compattaLabel: (n) =>
        n === 1 ? 'Un cliente non si è presentato' : `${n} clienti non si sono presentati`,
      late: true,
      hint: `Attesi da oltre ${LATE_GRACE_MINUTES} minuti e non ancora presi in carico: rimettili in coda quando arrivano, oppure segnalali assenti per il ricontatto.`,
      emptyLabel: 'Nessun cliente in ritardo.',
    },
    {
      key: 'closed',
      title: `Chiuse oggi · ${closed.length}`,
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
        const compattaChiusa =
          section.compatta === true && !ritardiAperti && section.rows.length > 0;
        // Calcolato una volta e usato da tutt'e due le forme dell'elenco (schede e tabella).
        const righe = section.rows.map((row) => {
          const desk = deskOf(row, desks);
          return {
            row,
            deskLabel: desk === null ? null : `${desk.code} · ${desk.name}`,
            foreignDesk: showDesk && homeDeskId !== null && desk !== null && desk.id !== homeDeskId,
            dueSoon:
              section.late !== true &&
              isDueWithinGrace(row.appointment, serverTime, LATE_GRACE_MINUTES),
            // Cambiata da poco: sale al suo posto invece di comparire e basta. Lo decide
            // `updatedAt` del server, non un contatore nel browser, così la riga si muove anche
            // quando a cambiarla è stato un collega da un altro banco — ed è lì che serve.
            appenaCambiata:
              new Date(serverTime).getTime() - new Date(row.appointment.updatedAt).getTime() <
              FINESTRA_MOVIMENTO_MS,
          };
        });
        // I ritardi chiusi: una riga sola che dice quanti sono e apre l'elenco. Il conto è la
        // notizia; i nomi servono solo a chi ha deciso di occuparsene adesso.
        if (compattaChiusa) {
          return (
            <section key={section.key}>
              <div className="border-priority-late-line bg-surface flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-5 py-3">
                <span className="bg-priority-late-soft text-priority-late-ink testo-nota flex size-7 shrink-0 items-center justify-center rounded-full font-bold tabular-nums">
                  {section.rows.length}
                </span>
                <span className="text-priority-late-ink testo-corpo font-semibold">
                  {section.compattaLabel?.(section.rows.length) ?? section.title}
                </span>
                <span className="text-ink-muted testo-nota min-w-0 flex-1 truncate">
                  {section.rows
                    .slice(0, 2)
                    .map(
                      (r) =>
                        `${r.appointment.code} · ${r.appointment.customer.lastName} ${r.appointment.customer.firstName}`,
                    )
                    .join(' · ')}
                  {section.rows.length > 2 ? ` · e altri ${section.rows.length - 2}` : ''}
                </span>
                <Button variant="outline" size="sm" onClick={() => setRitardiAperti(true)}>
                  Decidi
                </Button>
              </div>
            </section>
          );
        }

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
                  size="sm"
                  onClick={() => setClosedOpen((v) => !v)}
                  aria-expanded={!hidden}
                >
                  {hidden ? 'Mostra' : 'Nascondi'}
                </Button>
              ) : section.compatta === true && section.rows.length > 0 ? (
                <Button variant="ghost" size="sm" onClick={() => setRitardiAperti(false)}>
                  Richiudi
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
                {/*
                  L'elenco esiste in due forme e ne nasconde una il CSS: schede col dito, tabella
                  al banco. Sembra uno spreco tenerle entrambe nel DOM, e invece è la scelta meno
                  costosa: `display: none` toglie il ramo nascosto anche dall'albero di
                  accessibilità (nessun doppione per chi usa un lettore di schermo) e soprattutto
                  la struttura è già giusta al primo disegno, mentre leggendo un hook cambierebbe
                  dopo l'idratazione — cioè sfarfallerebbe sotto gli occhi dell'accettatore.
                */}
                <ul className="divide-line-subtle banco:hidden divide-y">
                  {righe.map(({ row, deskLabel, foreignDesk, dueSoon, appenaCambiata }, indice) => (
                    <Fragment key={`gruppo-${row.appointment.id}`}>
                      {section.evidenzaPrima === true && indice === 0 ? (
                        <li className="text-priority-now-ink testo-nota px-5 pt-4 font-semibold tracking-wide uppercase">
                          Tocca a lui adesso
                        </li>
                      ) : null}
                      {section.evidenzaPrima === true && indice === 1 ? (
                        <li className="text-ink-soft testo-nota px-5 pt-4 font-semibold tracking-wide uppercase">
                          Poi questi · {righe.length - 1}
                        </li>
                      ) : null}
                      <AppointmentCard
                        key={row.appointment.id}
                        row={row}
                        brandName={brandName(row.appointment.brandId)}
                        deskLabel={deskLabel}
                        showDesk={showDesk}
                        foreignDesk={foreignDesk}
                        dueSoon={dueSoon}
                        appenaCambiata={appenaCambiata}
                        evidenza={section.evidenzaPrima === true && indice === 0}
                        timeZone={timeZone}
                        pending={pendingId === row.appointment.id}
                        late={section.late === true}
                        lateByMinutes={section.late === true ? lateBy(row) : 0}
                        selected={row.appointment.id === selectedId}
                        readOnly={readOnly}
                        onAction={(action) =>
                          onAction(row.appointment.id, action, row.appointment.version)
                        }
                        onSelect={() => onSelect(row)}
                      />
                    </Fragment>
                  ))}
                </ul>

                <div className="banco:block hidden">
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
                        <TableHead className="hidden xl:table-cell">Accettazione</TableHead>
                        <TableHead className="hidden xl:table-cell">Operatore</TableHead>
                        {/* Larghezza propria: senza, i comandi si impilavano uno sotto l'altro e
                            la riga cresceva fino a duecento pixel. */}
                        <TableHead className="w-[23rem] text-right">Azioni</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {righe.map(
                        ({ row, deskLabel, foreignDesk, dueSoon, appenaCambiata }, indice) => (
                          <AppointmentRow
                            key={row.appointment.id}
                            row={row}
                            brandName={brandName(row.appointment.brandId)}
                            dueSoon={dueSoon}
                            appenaCambiata={appenaCambiata}
                            evidenza={section.evidenzaPrima === true && indice === 0}
                            deskLabel={deskLabel}
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
                        ),
                      )}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-ink-muted border-line-subtle border-t px-5 py-2.5 text-xs">
                  {section.rows.length} {section.rows.length === 1 ? 'pratica' : 'pratiche'} · tocca
                  una pratica per i dettagli del cliente
                </p>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
