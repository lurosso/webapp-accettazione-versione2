// Area di amministrazione: gestione degli operatori e strumenti di assistenza.
// Riservata ad ADMIN; gli altri ruoli vedono un messaggio esplicito invece di un redirect muto.
import type { Metadata } from 'next';
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
    <AdminDashboard
      session={session}
      businessDate={container.clock.today()}
      timeZone={container.env.timeZone}
    />
  );
}
