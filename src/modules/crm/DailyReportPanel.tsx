'use client';

// Riquadro "Statistiche del giorno" del cruscotto responsabile (M7).
//
// Tre numeri e tre percentuali, non un cruscotto di grafici: servono a rispondere a "come è andata
// oggi?" in cinque secondi. Accanto a ogni media c'è su quante pratiche è calcolata, perché una
// media su tre pratiche non è un indicatore, è un aneddoto.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { DailyReportView } from '@/application/reporting/DailyReportService';
import { Badge } from '@/components/ui/badge';
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
    <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">Statistiche del giorno</h2>
        <div className="flex flex-wrap items-center gap-2">
          {report !== undefined ? (
            <>
              <Badge tone="neutral">{report.total} pratiche</Badge>
              {report.stillOpen > 0 ? (
                <Badge tone="warning">{report.stillOpen} ancora aperte</Badge>
              ) : (
                <Badge tone="success">Giornata chiusa</Badge>
              )}
            </>
          ) : null}
          {/* Link e non fetch: il browser scarica il file come qualunque allegato, e funziona
              anche se JavaScript inciampa. */}
          <a
            href={`/api/v1/reports/daily/csv?giornata=${encodeURIComponent(businessDate)}`}
            className="bg-brand-blue hover:bg-brand-blue-dark focus-visible:ring-brand-blue-light inline-flex min-h-11 items-center rounded-md px-4 text-sm font-semibold text-white transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            download
          >
            Esporta report CSV
          </a>
        </div>
      </div>

      {query.isError ? (
        <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Statistiche non disponibili in questo momento: il resto del cruscotto continua a
          funzionare.
        </p>
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
        </>
      )}
    </section>
  );
}
