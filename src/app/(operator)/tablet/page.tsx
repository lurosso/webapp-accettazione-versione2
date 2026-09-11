// Vista tablet dell'accettazione (modulo E): l'accettatore la usa in piedi, accanto alle vetture.
// Stessa sessione e stessi permessi della dashboard; cambia il modo di presentare le pratiche.
import type { Metadata } from 'next';
import { requireSession } from '@/app/_server/session';
import { getContainer } from '@/config/container';
import { TabletQueue } from '@/modules/inspection-media/TabletQueue';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Tablet accettazione' };

export default async function TabletPage() {
  const session = await requireSession('/tablet');
  const container = getContainer();
  const workstation = await container.repos.referenceData.findWorkstationById(
    session.workstationId,
  );
  const homeDeskId = workstation?.deskId ?? session.deskIds[0] ?? null;

  return <TabletQueue session={session} homeDeskId={homeDeskId} />;
}
