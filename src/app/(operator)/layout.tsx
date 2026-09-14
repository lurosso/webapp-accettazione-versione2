// Layout dell'area operatore: richiede una sessione valida (altrimenti redirect al login) e
// costruisce la shell con postazione e sportello correnti.
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { requireSession } from '@/app/_server/session';
import { homePathForRole } from '@/lib/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { getContainer } from '@/config/container';

export const dynamic = 'force-dynamic';

export default async function OperatorLayout({ children }: { readonly children: ReactNode }) {
  // Rete di sicurezza dietro al proxy (che ha già il percorso richiesto): qui basta la radice,
  // che dopo il login smista ogni ruolo nella propria area.
  const session = await requireSession('/');
  // Un account kiosk ha una sessione valida ma nessuna area operatore: va agli schermi pubblici.
  if (session.role === 'KIOSK') {
    redirect(homePathForRole(session.role));
  }
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
