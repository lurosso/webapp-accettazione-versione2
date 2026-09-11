// Radice: smista verso l'area del ruolo (accettatore, responsabile, amministratore) oppure al
// login. Non si manda più tutti sulla dashboard dell'accettazione: ogni ruolo ha la propria home.
import { redirect } from 'next/navigation';
import { readSession } from '@/app/_server/session';
import { homePathForRole } from '@/lib/navigation';

export const dynamic = 'force-dynamic';

export default async function HomePage(): Promise<never> {
  const session = await readSession();
  redirect(session === null ? '/login' : homePathForRole(session.role));
}
