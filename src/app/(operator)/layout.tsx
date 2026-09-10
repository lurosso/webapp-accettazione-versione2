// Layout dell'area operatore: richiede una sessione valida (altrimenti redirect al login) e
// costruisce la shell con postazione e sportello correnti.
import type { ReactNode } from 'react';
import { requireSession } from '@/app/_server/session';
import { AppShell } from '@/components/layout/AppShell';
import { getContainer } from '@/config/container';

export const dynamic = 'force-dynamic';

export default async function OperatorLayout({ children }: { readonly children: ReactNode }) {
  const session = await requireSession('/accettazione');
  const container = getContainer();
  const workstation = await container.repos.referenceData.findWorkstationById(
    session.workstationId,
  );
  const desk =
    workstation === null
      ? null
      : await container.repos.referenceData.findDeskById(workstation.deskId);

  return (
    <AppShell
      session={session}
      workstationLabel={
        workstation === null ? 'Postazione n/d' : `${workstation.code} · ${workstation.name}`
      }
      deskLabel={desk === null ? 'Sportello n/d' : desk.name}
      timeZone={container.env.timeZone}
    >
      {children}
    </AppShell>
  );
}
