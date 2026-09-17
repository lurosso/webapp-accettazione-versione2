'use client';

// "Monitora l'accettazione" per l'amministratore: prima si sceglie COSA guardare, poi si guarda.
//
// Senza questo passaggio il pulsante avrebbe portato alla coda dello sportello della propria
// sessione, che per un amministratore non vuol dire niente: lui non sta a un banco. Qui i quattro
// sportelli sono elencati con chi ci sta lavorando e cosa sta facendo — le stesse informazioni del
// riquadro di assistenza, perché la domanda "quale guardo?" si risponde con "quello dove sta
// succedendo qualcosa" — più la coda globale, che si apre in sola lettura.
//
// Aprire uno sportello porta alla coda della sua area per marchio (A e B condividono la coda FCA,
// C e D quella PSA): è lì che stanno le pratiche di quel banco.
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { TableSkeleton } from '@/components/ui/skeleton';
import { fetchAssistance } from '@/lib/api-client/client';

export interface MonitorPanelProps {
  readonly timeZone: string;
}

/** Indirizzo della coda filtrata sull'area, con l'etichetta di cosa si sta monitorando. */
function monitorHref(deskId: string | null, etichetta: string): string {
  const params = new URLSearchParams({ view: 'desk', monitor: etichetta });
  if (deskId !== null) {
    params.set('deskId', deskId);
  }
  return `/accettazione?${params.toString()}`;
}

export function MonitorPanel({ timeZone: _timeZone }: MonitorPanelProps) {
  const query = useQuery({
    queryKey: ['admin-assistance'] as const,
    queryFn: fetchAssistance,
    refetchInterval: 10_000,
  });
  const data = query.data;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Monitora l&apos;accettazione</h2>
        <p className="text-sm text-slate-600">
          Scegli quale sportello controllare: si apre la coda della sua area per marchio, con le
          pratiche di quel banco. La <strong>coda globale</strong> mostra tutta l&apos;officina in
          sola lettura.
        </p>
      </div>

      {query.isPending || data === undefined ? (
        <TableSkeleton rows={2} columns={4} label="Caricamento degli sportelli" />
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {data.bays.map((bay) => (
              <li key={bay.bayId}>
                <Link
                  href={monitorHref(
                    bay.deskId,
                    `${bay.name}${bay.deskCode === null ? '' : ` · ${bay.deskCode}`}`,
                  )}
                  data-testid={`monitora-${bay.code}`}
                  className="focus-visible:ring-brand-blue-light flex min-h-11 flex-col gap-1 rounded-lg border border-slate-200 bg-slate-50 p-3 transition-colors hover:border-slate-300 hover:bg-white focus-visible:ring-2 focus-visible:outline-none"
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-base font-bold text-slate-900">{bay.name}</span>
                    {bay.deskCode !== null ? <Badge tone="neutral">{bay.deskCode}</Badge> : null}
                  </span>
                  <span className="text-sm text-slate-700">
                    {bay.assignedOperatorName ?? (
                      <span className="text-slate-500">nessun operatore collegato</span>
                    )}
                  </span>
                  <span className="text-xs text-slate-600">
                    {bay.occupiedBy === null
                      ? 'libero'
                      : `in lavorazione ${bay.occupiedBy.plate} · ${bay.occupiedBy.code}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          <Link
            href="/accettazione?view=global&sola-lettura=1&monitor=Coda%20globale"
            data-testid="monitora-globale"
            className="bg-brand-secondary hover:bg-brand-blue-dark focus-visible:ring-brand-blue-light mt-3 inline-flex min-h-11 items-center rounded-md px-4 text-sm font-semibold text-white focus-visible:ring-2 focus-visible:outline-none"
          >
            Coda globale (sola lettura)
          </Link>
        </>
      )}
    </section>
  );
}
