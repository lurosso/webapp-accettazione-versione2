'use client';

// Pannello di amministrazione: andamento della giornata, chiusura del turno, operatori,
// assistenza e integrazione WhatsApp (Spoki). Sezioni una sotto l'altra: un amministratore ci
// entra per un motivo preciso (vedere come sta andando, chiudere la giornata, creare un utente,
// sbloccare una pratica, capire perché un messaggio non è partito) e deve trovarlo senza cercare
// schede.
//
// Le statistiche aprono la pagina perché sono l'unica cosa che si guarda senza avere già in mente
// un'azione. Dal 2026-09-17 stanno solo qui: il BDC ha un elenco di clienti da richiamare, non un
// cruscotto di indicatori.
import type { Session } from '@/application/auth/IAuthService';
import { AssistancePanel } from './AssistancePanel';
import { CloseDayPanel } from './CloseDayPanel';
import { MonitorPanel } from './MonitorPanel';
import { DailyReportPanel } from './DailyReportPanel';
import { OperatorsPanel } from './OperatorsPanel';
import { SpokiPanel } from './SpokiPanel';

export interface AdminDashboardProps {
  readonly session: Session;
  /** Giornata operativa del server: le statistiche non si fidano dell'orologio del browser. */
  readonly businessDate: string;
  readonly timeZone: string;
}

export function AdminDashboard({ session, businessDate, timeZone }: AdminDashboardProps) {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Amministrazione</h1>
        <p className="text-sm text-slate-600">
          Andamento della giornata, chiusura del turno, operatori, assistenza e integrazione Spoki.
          Lo stato dei sistemi esterni e la coda verso il CRM sono nella pagina Sistema.
        </p>
      </header>
      <DailyReportPanel businessDate={businessDate} />
      <MonitorPanel timeZone={timeZone} />
      <CloseDayPanel businessDate={businessDate} />
      <OperatorsPanel currentOperatorId={session.operatorId} />
      <AssistancePanel timeZone={timeZone} />
      <SpokiPanel timeZone={timeZone} />
    </div>
  );
}
