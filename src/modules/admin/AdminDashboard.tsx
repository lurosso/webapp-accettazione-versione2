'use client';

// Pannello di amministrazione: gestione degli operatori e strumenti di assistenza.
// Due sezioni, una sotto l'altra: un amministratore ci entra per un motivo preciso (creare un
// utente, sbloccare una pratica) e deve trovarlo senza cercare schede.
import type { Session } from '@/application/auth/IAuthService';
import { AssistancePanel } from './AssistancePanel';
import { OperatorsPanel } from './OperatorsPanel';

export interface AdminDashboardProps {
  readonly session: Session;
  readonly timeZone: string;
}

export function AdminDashboard({ session, timeZone }: AdminDashboardProps) {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Amministrazione</h1>
        <p className="text-sm text-slate-600">
          Operatori e assistenza. Lo stato dei sistemi esterni e la coda verso il CRM sono nella
          pagina Sistema.
        </p>
      </header>
      <OperatorsPanel currentOperatorId={session.operatorId} />
      <AssistancePanel timeZone={timeZone} />
    </div>
  );
}
