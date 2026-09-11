// Monitor di campata (modulo D): /display/1 … /display/4, oppure /display/C1.
// Pagina pubblica pensata per i quattro schermi appesi sopra le campate dell'accettazione.
// Il token della campata è opzionale: /display/1?token=… (vedi la nota nell'API).
import type { Metadata } from 'next';
import { BayDisplayBoard } from '@/modules/bay-displays/BayDisplayBoard';

export const dynamic = 'force-dynamic';

interface PageProps {
  readonly params: Promise<{ readonly campata: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { campata } = await params;
  return { title: `Accettazione ${campata}` };
}

export default async function DisplayPage({ params, searchParams }: PageProps) {
  const [{ campata }, query] = await Promise.all([params, searchParams]);
  const rawToken = query['token'];
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;

  return <BayDisplayBoard bayRef={campata} token={token} />;
}
