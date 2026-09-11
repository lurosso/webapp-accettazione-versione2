// Area del responsabile di officina: oggi segnaposto, la rotta esiste e non rimanda altrove.
// L'accesso è consentito a SUPERVISOR e ADMIN; un accettatore riceve un messaggio esplicito.
import type { Metadata } from 'next';
import { requireSession } from '@/app/_server/session';
import { PlaceholderPage } from '@/components/shared/PlaceholderPage';
import { canAccess } from '@/lib/navigation';
import { AccessDenied } from '@/components/shared/AccessDenied';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Responsabile' };

export default async function ManagerPage() {
  const session = await requireSession('/manager');
  if (!canAccess('manager', session.role)) {
    return <AccessDenied area="area del responsabile" role={session.role} />;
  }

  return (
    <PlaceholderPage
      title="Dashboard Responsabile"
      intro="Vista di governo della giornata: andamento della coda, carichi per sportello e interventi
        sulle pratiche bloccate. In lavorazione, la rotta è già attiva per non spezzare la navigazione."
      planned={[
        { label: 'Tempi medi di attesa e di lavorazione per sportello', milestone: 'M6' },
        { label: 'Pratiche saltate più volte e segnalazioni di anomalia', milestone: 'M6' },
        { label: 'Registro degli invii WhatsApp e SMS con conferma manuale', milestone: 'M3' },
        { label: 'Riapertura dei no-show e forzatura degli stati', milestone: 'M1-T13' },
        { label: 'Esportazione della giornata per il BDC', milestone: 'M6' },
      ]}
      shortcuts={[
        { href: '/accettazione', label: 'Vai alla coda di accettazione' },
        { href: '/sistema', label: 'Stato dei sistemi esterni' },
      ]}
    />
  );
}
