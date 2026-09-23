'use client';

// Pannello di amministrazione, organizzato in quattro schede invece che in una colonna lunga.
//
// Prima era un unico rotolo di riquadri cresciuto una richiesta alla volta: le statistiche, gli
// sportelli, gli stessi sportelli un'altra volta per sceglierne uno, la chiusura di giornata, gli
// operatori, Spoki. Chi entrava per una cosa precisa scorreva tutto il resto, e due griglie
// identiche A-B-C-D a distanza di uno schermo facevano dubitare di quale fosse quella buona.
//
// L'ordine delle schede è quello delle domande che un amministratore si fa, dalla più frequente
// alla più rara:
// 1. Oggi — come sta andando adesso e com'è andata finora;
// 2. Monitoraggio — chi c'è ai banchi, cosa sta lavorando, cosa è rimasto fermo;
// 3. Sistema — le operazioni di fine turno e l'integrazione con il cliente;
// 4. Utenti e accessi — le anagrafiche, che si toccano una volta ogni tanto.
//
// La scheda scelta vive nell'indirizzo (`?sezione=`), così un collegamento salvato o un ricarico
// riportano dove si era, e ogni riquadro ha lo stesso contenitore: bordo chiaro, fondo bianco,
// ombra leggera, stessa spaziatura.
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Session } from '@/application/auth/IAuthService';
import { cn } from '@/lib/utils/cn';
import { AnomaliesPanel } from './AnomaliesPanel';
import { CloseDayPanel } from './CloseDayPanel';
import { DailyReportPanel } from './DailyReportPanel';
import { LiveQueuePanel } from './LiveQueuePanel';
import { MonitoringPanel } from './MonitoringPanel';
import { OperatorsPanel } from './OperatorsPanel';
import { SpokiPanel } from './SpokiPanel';
import { SystemAlertsPanel, systemAlertsKey } from './SystemAlertsPanel';
import { useLiveUpdates } from '@/hooks/useLiveUpdates';
import { fetchSystemAlerts } from '@/lib/api-client/client';

export interface AdminDashboardProps {
  readonly session: Session;
  /** Giornata operativa del server: le statistiche non si fidano dell'orologio del browser. */
  readonly businessDate: string;
  readonly timeZone: string;
}

const SEZIONI = [
  { id: 'oggi', label: 'Oggi', descrizione: 'La fila adesso e i numeri della giornata' },
  {
    id: 'monitoraggio',
    label: 'Monitoraggio operativo',
    descrizione: 'Sportelli, code, pratiche da sbloccare e anomalie della giornata',
  },
  {
    id: 'sistema',
    label: 'Sistema',
    descrizione: 'Segnalazioni dal personale, chiusura giornata e messaggi al cliente',
  },
  {
    id: 'utenti',
    label: 'Persone e postazioni',
    descrizione: 'Account, ruoli, sportelli e chi è collegato adesso',
  },
] as const;

type SezioneId = (typeof SEZIONI)[number]['id'];

function isSezione(value: string | null): value is SezioneId {
  return value !== null && SEZIONI.some((s) => s.id === value);
}

export function AdminDashboard({ session, businessDate, timeZone }: AdminDashboardProps) {
  const router = useRouter();
  const params = useSearchParams();
  const richiesta = params.get('sezione');
  const [sezione, setSezione] = useState<SezioneId>(isSezione(richiesta) ? richiesta : 'oggi');

  const vaiA = (id: SezioneId): void => {
    setSezione(id);
    // `replace`: cambiare scheda non deve riempire la cronologia del browser.
    router.replace(`/admin?sezione=${id}`, { scroll: false });
  };

  const corrente = SEZIONI.find((s) => s.id === sezione) ?? SEZIONI[0];
  // Le segnalazioni nuove si vedono dalla scheda, qualunque scheda sia aperta: è per questo che
  // esistono. Stessa query del pannello, aggiornata dal flusso eventi e dal polling.
  const segnalazioni = useQuery({
    queryKey: systemAlertsKey(false),
    queryFn: () => fetchSystemAlerts(false),
    refetchInterval: 30_000,
  });
  useLiveUpdates({
    url: '/api/v1/events/stream',
    types: ['SYSTEM_ALERT_CHANGED'],
    invalidate: [['system-alerts']],
  });
  const nuove = segnalazioni.data?.summary.new ?? 0;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-ink text-2xl font-bold tracking-tight">Amministrazione</h1>
        <p className="text-ink-soft text-sm">{corrente.descrizione}.</p>
      </header>

      {/* Schede: bersagli da 44 px, vanno a capo su un portatile o su un iPad. */}
      <div
        role="tablist"
        aria-label="Sezioni dell'amministrazione"
        className="bg-surface-sunken flex flex-wrap gap-1 rounded-lg p-1"
      >
        {SEZIONI.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            id={`tab-${s.id}`}
            aria-selected={sezione === s.id}
            aria-controls={`pannello-${s.id}`}
            data-testid={`tab-${s.id}`}
            onClick={() => vaiA(s.id)}
            className={cn(
              'focus-anello premibile controllo flex-1 rounded-md px-5 text-sm font-semibold whitespace-nowrap',
              sezione === s.id
                ? 'bg-brand-secondary text-white shadow-xs'
                : 'text-ink-soft hover:bg-surface/70',
            )}
          >
            {s.label}
            {s.id === 'sistema' && nuove > 0 ? (
              <span
                className="bg-status-no-show ml-2 inline-flex min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-bold text-white"
                data-testid="scheda-sistema-nuove"
                aria-label={`${nuove} segnalazioni nuove`}
              >
                {nuove}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`pannello-${sezione}`}
        aria-labelledby={`tab-${sezione}`}
        className="flex flex-col gap-8"
      >
        {sezione === 'oggi' ? (
          <>
            <LiveQueuePanel />
            <DailyReportPanel businessDate={businessDate} />
          </>
        ) : null}

        {sezione === 'monitoraggio' ? (
          <>
            <MonitoringPanel timeZone={timeZone} />
            <AnomaliesPanel businessDate={businessDate} timeZone={timeZone} />
          </>
        ) : null}

        {sezione === 'sistema' ? (
          <>
            <SystemAlertsPanel timeZone={timeZone} />
            <CloseDayPanel businessDate={businessDate} />
            <SpokiPanel timeZone={timeZone} />
          </>
        ) : null}

        {sezione === 'utenti' ? <OperatorsPanel currentOperatorId={session.operatorId} /> : null}
      </div>
    </div>
  );
}
