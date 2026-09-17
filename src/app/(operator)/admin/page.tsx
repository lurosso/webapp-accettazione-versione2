// Area di amministrazione: la fila di adesso, il monitoraggio degli sportelli, le operazioni di
// sistema e le anagrafiche, in quattro schede. Riservata ad ADMIN; gli altri ruoli vedono un
// messaggio esplicito invece di un redirect muto.
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { requireSession } from '@/app/_server/session';
import { AccessDenied } from '@/components/shared/AccessDenied';
import { getContainer } from '@/config/container';
import { canAccess } from '@/lib/navigation';
import { AdminDashboard } from '@/modules/admin/AdminDashboard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Amministrazione' };

export default async function AdminPage() {
  const session = await requireSession('/admin');
  if (!canAccess('admin', session.role)) {
    return <AccessDenied area="area di amministrazione" role={session.role} />;
  }
  const container = getContainer();
  return (
    // La scheda aperta sta nell'indirizzo (`?sezione=`), quindi il cruscotto legge i parametri:
    // serve la barriera, altrimenti la compilazione per la produzione si ferma qui.
    <Suspense fallback={<p className="text-sm text-slate-500">Caricamento del cruscotto…</p>}>
      <AdminDashboard
        session={session}
        businessDate={container.clock.today()}
        timeZone={container.env.timeZone}
      />
    </Suspense>
  );
}
