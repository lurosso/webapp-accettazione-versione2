// Dashboard accettazione (modulo A): la coda della giornata con azioni rapide e vista multi-sportello.
// Server Component: risolve sessione e sportello della postazione, poi delega al client in polling.
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { requireArea } from '@/app/_server/session';
import { getContainer } from '@/config/container';
import { canAccess } from '@/lib/navigation';
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
  // Area riservata a chi lavora al banco: il BDC che bussa qui finisce sul proprio cruscotto.
  const [session, params] = await Promise.all([
    requireArea('accettazione', '/accettazione'),
    searchParams,
  ]);
  const container = getContainer();
  const workstation = await container.repos.referenceData.findWorkstationById(
    session.workstationId,
  );
  const homeDeskId = workstation?.deskId ?? session.deskIds[0] ?? null;
  const richiesta = single(params['view']);
  const initialView: QueueView =
    richiesta === 'global' ? 'global' : richiesta === 'returns' ? 'returns' : 'desk';
  const initialDeskId = single(params['deskId']) ?? homeDeskId;
  // Monitoraggio dell'amministratore: `?sola-lettura=1` guarda senza toccare, `?monitor=` dice
  // cosa si sta guardando. Solo l'amministratore ci arriva, dal proprio pannello.
  const readOnly = single(params['sola-lettura']) === '1' && canAccess('admin', session.role);
  const monitorLabel = single(params['monitor']);
  // L'inserimento manuale nasce a monte in Infinity (BDC): il pulsante è nascosto per default e
  // si mostra solo secondo UI_MANUAL_INTAKE (managers | all).
  const manualIntakeEnabled =
    container.env.uiManualIntake === 'all' ||
    (container.env.uiManualIntake === 'managers' && canAccess('manager', session.role));

  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Caricamento della coda…</p>}>
      <QueueDashboard
        session={session}
        homeDeskId={homeDeskId}
        initialView={initialView}
        initialDeskId={initialDeskId}
        manualIntakeEnabled={manualIntakeEnabled}
        debugCustomerLink={container.env.devQuickLogin}
        readOnly={readOnly}
        monitorLabel={monitorLabel}
      />
    </Suspense>
  );
}
