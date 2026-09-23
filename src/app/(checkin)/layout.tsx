// Layout del check-in veicolo: stessa sessione e stessi permessi dell'area operatore, ma senza la
// shell (intestazione, navigazione, orologio). Sul piazzale il tablet deve sembrare un'app
// dedicata a una cosa sola: il giro fotografico. La barra minima (coda, esci) la disegna la
// schermata stessa, dove serve.
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { requireSession } from '@/app/_server/session';
import { homePathForRole } from '@/lib/navigation';
import { UploadResumer } from '@/modules/inspection-media/useUploadQueue';

export const dynamic = 'force-dynamic';

export default async function CheckInLayout({ children }: { readonly children: ReactNode }) {
  const session = await requireSession('/check-in');
  if (session.role === 'KIOSK') {
    redirect(homePathForRole(session.role));
  }
  return (
    <div className="min-h-dvh bg-slate-100 text-slate-900">
      {/* Foto e video rimasti sul tablet (rete caduta, pagina chiusa) ripartono da soli. */}
      <UploadResumer />
      {children}
    </div>
  );
}
