// /admin/spoki-test: la sola sezione "Integrazione Spoki & messaggistica", a pagina intera, per
// provare in modo controllato i due promemoria (giorno prima, giorno stesso) verso un numero
// digitato a mano. Riservata ad ADMIN. Con il blocco di sicurezza attivo o in simulazione nessun
// WhatsApp reale parte: il payload finisce nel registro della pagina.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '@/app/_server/session';
import { AccessDenied } from '@/components/shared/AccessDenied';
import { getContainer } from '@/config/container';
import { canAccess } from '@/lib/navigation';
import { SpokiPanel } from '@/modules/admin/SpokiPanel';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Test Spoki' };

export default async function SpokiTestPage() {
  const session = await requireSession('/admin/spoki-test');
  if (!canAccess('admin', session.role)) {
    return <AccessDenied area="test dei messaggi Spoki" role={session.role} />;
  }
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Test controllato dei promemoria Spoki</h1>
        <Link href="/admin" className="text-brand-secondary text-sm underline">
          Torna all&apos;amministrazione
        </Link>
      </div>
      <SpokiPanel timeZone={getContainer().env.timeZone} />
    </div>
  );
}
