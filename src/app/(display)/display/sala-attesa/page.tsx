// Tabellone della sala d'attesa (modulo D): /display/sala-attesa
// Pagina pubblica per il monitor grande della sala: mostra i codici chiamati con la campata a cui
// presentarsi e i prossimi turni. Con `?prossimi=` si regola quanti turni elencare.
// Essendo una rotta statica, ha la precedenza su /display/[campata]: nessun conflitto.
import type { Metadata } from 'next';
import { WaitingBoardScreen } from '@/modules/bay-displays/WaitingBoardScreen';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: "Sala d'attesa" };

/** Prossimi turni mostrati per impostazione predefinita, e limite accettato dall'URL. */
const DEFAULT_NEXT = 4;
const MAX_NEXT = 10;

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SalaAttesaPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const raw = params['prossimi'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = value === undefined ? Number.NaN : Number.parseInt(value, 10);
  const nextCount =
    Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_NEXT ? parsed : DEFAULT_NEXT;

  return <WaitingBoardScreen nextCount={nextCount} />;
}
