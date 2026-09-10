// Struttura dell'area operatore: header fisso + contenuto. Server Component (riceve dati già pronti).
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
    <div className="flex min-h-screen flex-col">
      <Header
        displayName={session.displayName}
        role={session.role}
        workstationLabel={workstationLabel}
        deskLabel={deskLabel}
        timeZone={timeZone}
      />
      <main className="mx-auto w-full max-w-screen-2xl flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
