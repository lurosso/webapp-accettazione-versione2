// Archivio delle ispezioni fotografiche (area operatore): storico dei check-in, ricerca per
// targa o codice. Server Component: risolve sessione e configurazione, poi delega al client.
import type { Metadata } from 'next';
import { requireSession } from '@/app/_server/session';
import { AccessDenied } from '@/components/shared/AccessDenied';
import { getContainer } from '@/config/container';
import { canAccess } from '@/lib/navigation';
import { InspectionArchive } from '@/modules/inspection-media/InspectionArchive';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Archivio ispezioni' };

export default async function ArchivioPage() {
  const session = await requireSession('/accettazione/archivio');
  if (!canAccess('accettazione', session.role)) {
    return <AccessDenied area="archivio delle ispezioni" role={session.role} />;
  }
  const container = getContainer();
  return (
    <InspectionArchive
      timeZone={container.env.timeZone}
      retentionDays={container.env.photoRetentionDays}
    />
  );
}
