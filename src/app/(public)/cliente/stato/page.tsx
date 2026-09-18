// Esito della ricerca dal QR: stessa schermata del portale (`/portal`), raggiunta con la sola
// targa. Senza targa nell'URL si torna alla ricerca.
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PublicStatusView } from '@/modules/customer-portal/PublicStatusView';
import { formatPlateInput } from '@/modules/customer-portal/plate-input';

export const metadata: Metadata = { title: 'Il suo turno in officina' };

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function single(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? (v[0] ?? '') : (v ?? '')).trim();
}

export default async function StatoPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const targa = formatPlateInput(single(params['targa']) || single(params['plate']));
  const token = single(params['t']).toLowerCase();
  if (targa === '' && token === '') {
    redirect('/cliente');
  }

  return <PublicStatusView targa={targa} token={token === '' ? null : token} />;
}
