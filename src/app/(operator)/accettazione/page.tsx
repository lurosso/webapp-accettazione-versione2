// Dashboard accettazione (modulo A): la coda della giornata con azioni rapide e vista multi-sportello.
// Server Component: risolve sessione e sportello della postazione, poi delega al client in polling.
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { requireSession } from '@/app/_server/session';
import { getContainer } from '@/config/container';
import { QueueDashboard } from '@/modules/reception/QueueDashboard';
import type { QueueView } from '@/modules/reception/types';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Coda accettazione' };

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function single(v: string | string[] | undefined): string | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

export default async function AccettazionePage({ searchParams }: PageProps) {
  const [session, params] = await Promise.all([requireSession('/accettazione'), searchParams]);
  const container = getContainer();
  const workstation = await container.repos.referenceData.findWorkstationById(
    session.workstationId,
  );
  const homeDeskId = workstation?.deskId ?? session.deskIds[0] ?? null;
  const initialView: QueueView = single(params['view']) === 'global' ? 'global' : 'desk';
  const initialDeskId = single(params['deskId']) ?? homeDeskId;

  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Caricamento della coda…</p>}>
      <QueueDashboard
        session={session}
        homeDeskId={homeDeskId}
        initialView={initialView}
        initialDeskId={initialDeskId}
      />
    </Suspense>
  );
}
