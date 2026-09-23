// Portale cliente mobile: la pagina aperta dal QR (`/portal?targa=AB123CD`) o dal token della
// pratica (`/portal?t=…`; lo smart link dei messaggi WhatsApp è `/portal/<token>`). Nessun login:
// si entra con la targa o con il token unico della pratica. Mostra il percorso della vettura in
// tempo reale e permette di avvisare un ritardo o l'arrivo con un tocco.
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PublicStatusView } from '@/modules/customer-portal/PublicStatusView';
import { formatPlateInput } from '@/modules/customer-portal/plate-input';

export const metadata: Metadata = {
  title: 'Il suo turno in officina',
  description: 'Codice, posizione in coda e avanzamento della pratica, aggiornati in tempo reale.',
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
