// Radice: reindirizza alla dashboard se la sessione è valida, altrimenti al login (M1-T10-S02).
// Lo stato delle porte esterne, prima mostrato qui, vive ora in /sistema (area autenticata).
import { redirect } from 'next/navigation';
import { readSession } from '@/app/_server/session';

export const dynamic = 'force-dynamic';

export default async function HomePage(): Promise<never> {
  const session = await readSession();
  redirect(session === null ? '/login' : '/accettazione');
}
