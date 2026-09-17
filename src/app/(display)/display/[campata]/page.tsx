// Monitor di sportello (modulo D): /display/A … /display/D (valgono ancora /display/1 … /display/4
// e le vecchie targhette /display/C1). Pagina pubblica per i quattro schermi appesi sopra gli
// sportelli dell'accettazione. Il token dello sportello è opzionale: /display/A?token=…
import type { Metadata } from 'next';
import { BayDisplayBoard } from '@/modules/bay-displays/BayDisplayBoard';

export const dynamic = 'force-dynamic';

interface PageProps {
  readonly params: Promise<{ readonly campata: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { campata } = await params;
  return { title: `Sportello ${campata.trim().toUpperCase()}` };
}

export default async function DisplayPage({ params, searchParams }: PageProps) {
  const [{ campata }, query] = await Promise.all([params, searchParams]);
  const rawToken = query['token'];
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;

  return <BayDisplayBoard bayRef={campata} token={token} />;
}
