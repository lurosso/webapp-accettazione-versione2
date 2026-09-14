// Check-in veicolo (modulo E): la vista che l'accettatore usa in piedi, accanto alle vetture, dal
// tablet. Stessa sessione e stessi permessi della dashboard; cambia tutto il resto: niente
// intestazione del sito, schede grandi, giro fotografico a tutto schermo.
import type { Metadata } from 'next';
import { requireSession } from '@/app/_server/session';
import { getContainer } from '@/config/container';
import { CHECK_IN_PARAM } from '@/lib/navigation';
import { CheckInQueue } from '@/modules/inspection-media/CheckInQueue';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Check-in veicolo' };

interface CheckInPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CheckInPage({ searchParams }: CheckInPageProps) {
  const [session, params] = await Promise.all([requireSession('/check-in'), searchParams]);
  const container = getContainer();
  const workstation = await container.repos.referenceData.findWorkstationById(
    session.workstationId,
  );
  const homeDeskId = workstation?.deskId ?? session.deskIds[0] ?? null;
  // Arrivando dalla dashboard (presa in carico da tablet, o "Passa al check-in" dal dettaglio) il
  // parametro dice quale pratica aprire subito, senza far cercare la scheda in elenco.
  const richiesta = params[CHECK_IN_PARAM];
  const appointmentId = (Array.isArray(richiesta) ? richiesta[0] : richiesta) ?? null;

  return (
    <CheckInQueue
      session={session}
      homeDeskId={homeDeskId}
      workstationLabel={workstation?.name ?? 'Accettazione n/d'}
      openCheckInFor={appointmentId}
    />
  );
}
