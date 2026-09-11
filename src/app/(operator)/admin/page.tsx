// Area di amministrazione: oggi segnaposto, la rotta esiste e non rimanda altrove.
// Riservata ad ADMIN; gli altri ruoli vedono un messaggio esplicito invece di un redirect muto.
import type { Metadata } from 'next';
import { requireSession } from '@/app/_server/session';
import { AccessDenied } from '@/components/shared/AccessDenied';
import { PlaceholderPage } from '@/components/shared/PlaceholderPage';
import { canAccess } from '@/lib/navigation';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Amministrazione' };

export default async function AdminPage() {
  const session = await requireSession('/admin');
  if (!canAccess('admin', session.role)) {
    return <AccessDenied area="area di amministrazione" role={session.role} />;
  }

  return (
    <PlaceholderPage
      title="Dashboard Admin"
      intro="Configurazione del sistema e strumenti di manutenzione. In lavorazione: la rotta è già
        attiva, così la navigazione e i permessi si possono provare fin d'ora."
      planned={[
        { label: 'Anagrafiche: marchi, sportelli, postazioni, campate', milestone: 'M6' },
        { label: 'Operatori e ruoli, reimpostazione delle password', milestone: 'M6' },
        { label: 'Interruttori dei mock e sincronizzazione manuale', milestone: 'M1-T15' },
        { label: 'Coda degli eventi verso il CRM e loro rinvio', milestone: 'M6' },
        { label: 'Passaggio ai servizi reali, una porta alla volta', milestone: 'M7' },
      ]}
      shortcuts={[
        { href: '/sistema', label: 'Stato dei sistemi esterni' },
        { href: '/accettazione', label: 'Vai alla coda di accettazione' },
        { href: '/display/1', label: 'Anteprima monitor campata 1' },
      ]}
    />
  );
}
