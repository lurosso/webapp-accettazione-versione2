// Archivio delle ispezioni fotografiche (area operatore): storico dei check-in, ricerca per
// targa o codice. Server Component: risolve sessione e configurazione, poi delega al client.
import type { Metadata } from 'next';
import { requireArea } from '@/app/_server/session';
import { getContainer } from '@/config/container';
import { InspectionArchive } from '@/modules/inspection-media/InspectionArchive';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Archivio ispezioni' };

export default async function ArchivioPage() {
  // Stessa area della coda: l'archivio delle ispezioni è lavoro del banco, non del BDC.
  await requireArea('accettazione', '/accettazione/archivio');
  const container = getContainer();
  return (
    <InspectionArchive
      timeZone={container.env.timeZone}
      retentionDays={container.env.photoRetentionDays}
    />
  );
}
