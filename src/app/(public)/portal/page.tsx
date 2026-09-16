// Portale cliente mobile: la pagina aperta dal link WhatsApp (`/portal?targa=AB123CD&t=…`) e dal
// QR. Nessun login: si entra con la targa o con il token unico della pratica. Mostra il percorso
// della vettura in tempo reale e permette di avvisare un ritardo con un tocco.
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PublicStatusView } from '@/modules/customer-portal/PublicStatusView';
import { formatPlateInput } from '@/modules/customer-portal/plate-input';

export const metadata: Metadata = {
  title: 'Il tuo turno in officina',
  description: 'Segui in tempo reale la tua pratica: codice, posizione in coda e avanzamento.',
};

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function single(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? (v[0] ?? '') : (v ?? '')).trim();
}

export default async function PortalPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const targa = formatPlateInput(single(params['targa']) || single(params['plate']));
  const token = single(params['t']).toLowerCase();
  if (targa === '' && token === '') {
    redirect('/cliente');
  }
  return <PublicStatusView targa={targa} token={token === '' ? null : token} />;
}
