// Area del responsabile / BDC (modulo F): il cruscotto dei clienti da ricontattare.
// Server Component: risolve sessione, giornata operativa e fuso, poi delega al client in polling.
// L'accesso è consentito a SUPERVISOR e ADMIN; un accettatore riceve un messaggio esplicito.
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { requireSession } from '@/app/_server/session';
import { AccessDenied } from '@/components/shared/AccessDenied';
import { getContainer } from '@/config/container';
import { canAccess } from '@/lib/navigation';
import { BdcDashboard } from '@/modules/crm/BdcDashboard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Cruscotto BDC' };

export default async function ManagerPage() {
  const session = await requireSession('/manager');
  if (!canAccess('manager', session.role)) {
    return <AccessDenied area="area del responsabile" role={session.role} />;
  }
  const container = getContainer();

  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Caricamento dei lead…</p>}>
      <BdcDashboard
        session={session}
        businessDate={container.clock.today()}
        timeZone={container.env.timeZone}
      />
    </Suspense>
  );
}
