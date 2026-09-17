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
import type { Session } from '@/application/auth/IAuthService';
import { cn } from '@/lib/utils/cn';
import { CloseDayPanel } from './CloseDayPanel';
import { DailyReportPanel } from './DailyReportPanel';
import { LiveQueuePanel } from './LiveQueuePanel';
import { MonitoringPanel } from './MonitoringPanel';
import { OperatorsPanel } from './OperatorsPanel';
import { SpokiPanel } from './SpokiPanel';

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
    label: 'Monitoraggio',
    descrizione: 'Sportelli, code e pratiche da sbloccare',
  },
  { id: 'sistema', label: 'Sistema', descrizione: 'Chiusura giornata e messaggi al cliente' },
  { id: 'utenti', label: 'Utenti e accessi', descrizione: 'Account, ruoli e password' },
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

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Amministrazione</h1>
        <p className="text-sm text-slate-600">{corrente.descrizione}.</p>
      </header>

      {/* Schede: bersagli da 44 px, vanno a capo su un portatile o su un iPad. */}
      <div
        role="tablist"
        aria-label="Sezioni dell'amministrazione"
        className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1"
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
              'focus-visible:ring-brand-blue-light min-h-11 flex-1 rounded-lg px-4 text-sm font-semibold whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:outline-none',
              sezione === s.id
                ? 'bg-brand-secondary text-white shadow-sm'
                : 'text-slate-700 hover:bg-white/70',
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`pannello-${sezione}`}
        aria-labelledby={`tab-${sezione}`}
        className="flex flex-col gap-6"
      >
        {sezione === 'oggi' ? (
          <>
            <LiveQueuePanel />
            <DailyReportPanel businessDate={businessDate} />
          </>
        ) : null}

        {sezione === 'monitoraggio' ? <MonitoringPanel timeZone={timeZone} /> : null}

        {sezione === 'sistema' ? (
          <>
            <CloseDayPanel businessDate={businessDate} />
            <SpokiPanel timeZone={timeZone} />
          </>
        ) : null}

        {sezione === 'utenti' ? <OperatorsPanel currentOperatorId={session.operatorId} /> : null}
      </div>
    </div>
  );
}
