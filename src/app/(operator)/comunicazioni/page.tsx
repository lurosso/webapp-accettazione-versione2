// Schermata Comunicazioni (area autenticata): i messaggi al cliente non arrivati, da ritentare o
// da sostituire con una telefonata. Aperta a banco, BDC e amministratore (`AREA_ROLES`).
// Server Component: risolve sessione, giornata e fuso; la lista è un client che si rilegge da solo.
import type { Metadata } from 'next';
import { requireArea } from '@/app/_server/session';
import { getContainer } from '@/config/container';
import { CommunicationsDashboard } from '@/modules/notifications/CommunicationsDashboard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Comunicazioni' };

export default async function ComunicazioniPage() {
  const session = await requireArea('comunicazioni', '/comunicazioni');
  const container = getContainer();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <CommunicationsDashboard
        session={{ displayName: session.displayName, role: session.role }}
        businessDate={container.clock.today()}
        timeZone={container.env.timeZone}
      />
    </div>
  );
}
