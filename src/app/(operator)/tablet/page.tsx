// Vecchio indirizzo della vista tablet: rimanda al check-in conservando la pratica richiesta.
// Resta per i segnalibri e i collegamenti salvati sui tablet prima della rinominazione.
import { redirect } from 'next/navigation';
import { CHECK_IN_PARAM, checkInPath } from '@/lib/navigation';

export const dynamic = 'force-dynamic';

interface TabletRedirectProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function TabletRedirect({
  searchParams,
}: TabletRedirectProps): Promise<never> {
  const params = await searchParams;
  const richiesta = params[CHECK_IN_PARAM];
  const appointmentId = Array.isArray(richiesta) ? richiesta[0] : richiesta;
  redirect(appointmentId === undefined ? '/check-in' : checkInPath(appointmentId));
}
