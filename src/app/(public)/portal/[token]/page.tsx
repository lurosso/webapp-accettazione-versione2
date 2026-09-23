// Smart link del portale cliente: `/portal/<token>`, l'indirizzo che il cliente riceve su WhatsApp
// («Sono arrivato» → codice e link personale). Il token è l'HMAC della pratica: chi lo ha nel
// messaggio apre direttamente il proprio stato di attesa, senza scrivere targa né codice. Nessun
// dato personale nell'indirizzo: non c'è la targa, e il token non si indovina.
//
// La pagina è la stessa di `/portal?t=…`: stato in tempo reale, «Sono arrivato», «In ritardo».
// Un token che non ha la forma attesa non si cerca nemmeno: si torna all'ingresso per targa.
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { isPortalToken } from '@/application/portal/portal-token';
import { PublicStatusView } from '@/modules/customer-portal/PublicStatusView';

export const metadata: Metadata = {
  title: 'Il suo turno in officina',
  description: 'Codice, posizione in coda e avanzamento della pratica, aggiornati in tempo reale.',
};

interface PageProps {
  readonly params: Promise<{ readonly token: string }>;
}

export default async function PortalTokenPage({ params }: PageProps) {
  const { token } = await params;
  // Next consegna il segmento già decodificato: una seconda decodifica su un '%' spaiato lancerebbe.
  const pulito = token.trim().toLowerCase();
  if (!isPortalToken(pulito)) {
    redirect('/cliente');
  }
  return <PublicStatusView targa="" token={pulito} />;
}
