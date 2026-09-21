// Struttura dell'area operatore. Server Component (riceve dati già pronti).
//
// La direzione cambia con il puntatore e basta una classe: col dito la navigazione sta in alto e
// il contenuto sotto, al banco la navigazione è la colonna di sinistra e il contenuto le sta
// accanto. Il componente resta un Server Component perché a decidere è il CSS, non un hook.
import type { ReactNode } from 'react';
import type { Session } from '@/application/auth/IAuthService';
import { Header } from './Header';

export interface AppShellProps {
  readonly session: Session;
  readonly workstationLabel: string;
  readonly deskLabel: string;
  readonly timeZone: string;
  readonly children: ReactNode;
}

export function AppShell({
  session,
  workstationLabel,
  deskLabel,
  timeZone,
  children,
}: AppShellProps) {
  return (
    <div className="bg-surface-app banco:flex-row flex min-h-screen flex-col">
      <Header
        displayName={session.displayName}
        role={session.role}
        workstationLabel={workstationLabel}
        deskLabel={deskLabel}
        timeZone={timeZone}
      />
      {/*
       * `min-w-0` non è un dettaglio: dentro una riga flex, senza, una tabella larga allarga il
       * contenitore invece di scorrere al proprio interno e spinge fuori la colonna di sinistra.
       */}
      <main className="banco:mx-0 banco:min-w-0 banco:max-w-none banco:px-8 banco:py-7 mx-auto w-full max-w-screen-2xl flex-1 px-4 py-6 sm:px-6">
        {children}
      </main>
    </div>
  );
}
