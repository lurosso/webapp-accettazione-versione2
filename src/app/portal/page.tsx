// Alias pubblico usato nei messaggi WhatsApp: /portal?targa=AB123CD → stato del turno.
// Un indirizzo corto e stabile nel messaggio; la pagina vera resta /cliente/stato.
import { redirect } from 'next/navigation';

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PortalPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const raw = params['targa'] ?? params['plate'];
  const targa = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? '';
  redirect(targa === '' ? '/cliente' : `/cliente/stato?targa=${encodeURIComponent(targa)}`);
}
