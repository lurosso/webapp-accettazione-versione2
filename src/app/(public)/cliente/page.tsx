// Portale cliente (modulo B): pagina di ingresso raggiunta dal QR code, con la ricerca per targa.
// Pubblica: nessuna sessione, nessun dato personale. Essenziale (M8-T56): un titolo, una riga,
// il campo e il pulsante.
import type { Metadata } from 'next';
import { PlateSearchForm } from '@/modules/customer-portal/PlateSearchForm';

export const metadata: Metadata = {
  title: 'Il suo turno in officina',
  description: 'Scriva la targa per vedere il suo codice e quante auto ci sono prima di lei.',
};

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function single(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function ClientePage({ searchParams }: PageProps) {
  const params = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2 text-center">
        <h1 className="text-ink text-4xl font-bold tracking-tight">Il suo turno</h1>
        <p className="text-ink-soft text-xl">Scriva la targa per vedere il suo codice.</p>
      </header>

      <div className="border-line bg-surface rounded-3xl border-2 px-5 py-6 shadow-sm">
        <PlateSearchForm
          initialPlate={single(params['targa']) ?? ''}
          source={single(params['src'])}
        />
      </div>
    </div>
  );
}
