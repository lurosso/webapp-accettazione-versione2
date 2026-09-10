// Esito della ricerca: stato della pratica in tempo reale (polling ogni 5 s lato client).
// Senza targa nell'URL si torna alla ricerca.
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PublicStatusView } from '@/modules/customer-portal/PublicStatusView';
import { formatPlateInput } from '@/modules/customer-portal/plate-input';

export const metadata: Metadata = { title: 'Il tuo turno in officina' };

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function single(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? (v[0] ?? '') : (v ?? '')).trim();
}

export default async function StatoPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const targa = formatPlateInput(single(params['targa']) || single(params['plate']));
  if (targa === '') {
    redirect('/cliente');
  }

  return <PublicStatusView targa={targa} />;
}
