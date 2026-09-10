// Alias breve stampato sui QR code delle corsie: /qr → /cliente (la corsia resta in `src`).
// Un URL corto sul cartello riduce gli errori di digitazione per chi non può scansionare il codice.
import { redirect } from 'next/navigation';

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function QrPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const src = params['src'];
  const value = (Array.isArray(src) ? src[0] : src)?.trim();
  redirect(
    value === undefined || value === '' ? '/cliente' : `/cliente?src=${encodeURIComponent(value)}`,
  );
}
