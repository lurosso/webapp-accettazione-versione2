// Vista tablet dell'accettazione (modulo E): l'accettatore la usa in piedi, accanto alle vetture.
// Stessa sessione e stessi permessi della dashboard; cambia il modo di presentare le pratiche.
import type { Metadata } from 'next';
import { requireSession } from '@/app/_server/session';
import { getContainer } from '@/config/container';
import { CHECK_IN_PARAM } from '@/lib/navigation';
import { TabletQueue } from '@/modules/inspection-media/TabletQueue';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Tablet accettazione' };

interface TabletPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function TabletPage({ searchParams }: TabletPageProps) {
  const [session, params] = await Promise.all([requireSession('/tablet'), searchParams]);
  const container = getContainer();
  const workstation = await container.repos.referenceData.findWorkstationById(
    session.workstationId,
  );
  const homeDeskId = workstation?.deskId ?? session.deskIds[0] ?? null;
  // Arrivando dalla dashboard (o dal pannello di dettaglio) il parametro dice quale pratica
  // aprire subito in ispezione, senza far cercare la scheda in elenco.
  const richiesta = params[CHECK_IN_PARAM];
  const appointmentId = (Array.isArray(richiesta) ? richiesta[0] : richiesta) ?? null;

  return <TabletQueue session={session} homeDeskId={homeDeskId} openCheckInFor={appointmentId} />;
}
