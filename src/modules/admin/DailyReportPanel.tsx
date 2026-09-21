'use client';

// Riquadro "Statistiche del giorno" della vista amministratore (M7).
//
// Tre numeri e tre percentuali, non un cruscotto di grafici: servono a rispondere a "come è andata
// oggi?" in cinque secondi. Accanto a ogni media c'è su quante pratiche è calcolata, perché una
// media su tre pratiche non è un indicatore, è un aneddoto.
//
// Dal 2026-09-17 sta qui e non più nel cruscotto BDC: sono numeri sulle persone che lavorano in
// officina e li guarda chi ha la responsabilità dell'insieme. Al BDC serve un elenco di clienti da
// richiamare, e una fila di indicatori sopra quell'elenco non lo aiuta a telefonare.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { DailyReportView } from '@/application/reporting/DailyReportService';
import { Badge } from '@/components/ui/badge';
import { Notice } from '@/components/ui/notice';
import { Panel, PanelHeader } from '@/components/ui/panel';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils/cn';
import { fetchDailyReport } from '@/lib/api-client/client';

export interface DailyReportPanelProps {
  /** Giornata da riepilogare (quella operativa del server). */
  readonly businessDate: string;
}

/** Aggiornamento tranquillo: i numeri della giornata non cambiano ogni secondo. */
const REPORT_POLLING_MS = 30_000;

function minuti(valore: number | null): string {
  return valore === null ? '—' : `${valore.toString().replace('.', ',')} min`;
}

function Indicatore({
  titolo,
  valore,
  dettaglio,
}: {
  readonly titolo: string;
  readonly valore: string;
  readonly dettaglio: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <dt className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{titolo}</dt>
      <dd className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{valore}</dd>
      <p className="text-xs text-slate-500">{dettaglio}</p>
    </div>
  );
}

/** Barra della conversione: completate, assenti, annullate. */
function Conversione({ report }: { readonly report: DailyReportView }) {
  const segmenti = [
    { etichetta: 'Completate', valore: report.rates.completed, classe: 'bg-status-completed' },
    { etichetta: 'Assenti', valore: report.rates.noShow, classe: 'bg-status-no-show' },
    { etichetta: 'Annullate', valore: report.rates.cancelled, classe: 'bg-slate-400' },
  ];
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
        Esito della giornata
      </p>
      <div
        className="mt-2 flex h-3 w-full overflow-hidden rounded-full bg-slate-100"
        role="img"
        aria-label={segmenti.map((s) => `${s.etichetta} ${s.valore}%`).join(', ')}
      >
        {segmenti.map((s) => (
          <span key={s.etichetta} className={s.classe} style={{ width: `${s.valore}%` }} />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-700">
        {segmenti.map((s) => (
          <li key={s.etichetta} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={`inline-block h-2.5 w-2.5 rounded-full ${s.classe}`}
            />
            {s.etichetta}{' '}
            <strong className="tabular-nums">{s.valore.toString().replace('.', ',')}%</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DailyReportPanel({ businessDate }: DailyReportPanelProps) {
  const query = useQuery({
    queryKey: ['daily-report', businessDate] as const,
    queryFn: () => fetchDailyReport(businessDate),
    refetchInterval: REPORT_POLLING_MS,
    placeholderData: keepPreviousData,
  });
  const report = query.data;

  return (
    <Panel>
      <PanelHeader
        title="La giornata finora"
        description="Il consuntivo dalle prime pratiche a questo momento: quante ne sono state chiuse e quante sono rimaste indietro."
        meta={
          report !== undefined ? (
            <>
              <Badge tone="neutral">{report.total} pratiche</Badge>
              {report.stillOpen > 0 ? (
                <Badge tone="warning" dot>
                  {report.stillOpen} ancora aperte
                </Badge>
              ) : (
                <Badge tone="success" dot>
                  Giornata chiusa
                </Badge>
              )}
            </>
          ) : null
        }
        actions={
          /* Link e non fetch: il browser scarica il file come qualunque allegato, e funziona
             anche se JavaScript inciampa. */
          <a
            href={`/api/v1/reports/daily/csv?giornata=${encodeURIComponent(businessDate)}`}
            className="border-line bg-surface text-ink-soft hover:bg-surface-sunken premibile focus-anello controllo inline-flex items-center rounded-md border px-5 text-sm font-semibold"
            download
          >
            Esporta report CSV
          </a>
        }
      />

      {query.isError ? (
        <Notice tone="warning">
          Statistiche non disponibili in questo momento: il resto del cruscotto continua a
          funzionare.
        </Notice>
      ) : report === undefined ? (
        <p className="text-sm text-slate-500">Calcolo delle statistiche…</p>
      ) : (
        <>
          <dl className="grid gap-3 sm:grid-cols-3">
            <Indicatore
              titolo="Attesa media"
              valore={minuti(report.averageWait.minutes)}
              dettaglio={
                report.averageWait.sampleSize === 0
                  ? 'Nessuna pratica presa in carico'
                  : `Su ${report.averageWait.sampleSize} pratiche prese in carico${
                      report.longestWaitMinutes === null
                        ? ''
                        : ` · attesa massima ${minuti(report.longestWaitMinutes)}`
                    }`
              }
            />
            <Indicatore
              titolo="Accettazione media"
              valore={minuti(report.averageService.minutes)}
              dettaglio={
                report.averageService.sampleSize === 0
                  ? 'Nessuna accettazione conclusa'
                  : `Dalla presa in carico alla chiusura · ${report.averageService.sampleSize} pratiche`
              }
            />
            <Indicatore
              titolo="Completate"
              valore={`${report.counts.COMPLETED}`}
              dettaglio={`${report.counts.NO_SHOW} assenti · ${report.counts.CANCELLED} annullate`}
            />
          </dl>
          <div className="mt-3">
            <Conversione report={report} />
          </div>

          {/*
           * Gli indicatori sopra dicono com'è andata l'officina; questa dice DOVE. Un'attesa media
           * di ventuno minuti può essere tre sportelli tranquilli e uno in affanno, e finché il
           * numero resta uno solo la differenza non si vede — si vedeva aprendo il CSV.
           */}
          {report.byDesk.length > 1 ? (
            <div className="mt-6">
              <h3 className="text-ink testo-dato mb-2 font-semibold">Sportello per sportello</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sportello</TableHead>
                    <TableHead className="text-right">Previste</TableHead>
                    <TableHead className="text-right">Completate</TableHead>
                    <TableHead className="text-right">Assenti</TableHead>
                    <TableHead className="text-right">Attesa media</TableHead>
                    <TableHead className="text-right">In coda</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.byDesk.map((d) => (
                    <TableRow key={d.deskId ?? 'senza'}>
                      <TableCell className="font-semibold">{d.label}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.expected}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.completed}</TableCell>
                      <TableCell
                        className={cn(
                          'text-right tabular-nums',
                          d.noShow > 0 && 'text-status-no-show-ink font-semibold',
                        )}
                      >
                        {d.noShow}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {minuti(d.averageWaitMinutes)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right tabular-nums',
                          d.stillInQueue > 0 && 'text-priority-now-ink font-semibold',
                        )}
                      >
                        {d.stillInQueue}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-surface-sunken font-semibold">
                    <TableCell>Totale</TableCell>
                    <TableCell className="text-right tabular-nums">{report.total}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {report.counts.COMPLETED}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {report.counts.NO_SHOW}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {minuti(report.averageWait.minutes)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{report.stillOpen}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          ) : null}
        </>
      )}
    </Panel>
  );
}
