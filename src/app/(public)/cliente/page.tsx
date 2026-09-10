// Portale cliente (modulo B): pagina di ingresso raggiunta dal QR code, con la ricerca per targa.
// Pubblica: nessuna sessione, nessun dato personale.
import type { Metadata } from 'next';
import { PlateSearchForm } from '@/modules/customer-portal/PlateSearchForm';

export const metadata: Metadata = {
  title: 'Il tuo turno in officina',
  description: 'Inserisci la targa per vedere il tuo codice e quanti clienti ci sono prima di te.',
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
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Il tuo turno</h1>
        <p className="text-lg text-slate-600">
          Inserisci la targa del veicolo per vedere il tuo codice di prenotazione e quanti clienti
          ci sono prima di te.
        </p>
      </header>

      <div className="rounded-2xl border-2 border-slate-200 bg-white p-6 shadow-sm">
        <PlateSearchForm
          initialPlate={single(params['targa']) ?? ''}
          source={single(params['src'])}
        />
      </div>

      <p className="text-center text-sm text-slate-500">
        Usiamo la targa solo per mostrarti la tua posizione in coda: non vengono mostrati dati
        personali e non conserviamo la ricerca.
      </p>
    </div>
  );
}
