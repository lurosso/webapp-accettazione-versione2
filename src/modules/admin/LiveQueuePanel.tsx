'use client';

// Il polso della fila, in cima alla dashboard dell'amministratore.
//
// Le statistiche del giorno dicono com'è andata; questi quattro numeri dicono cosa sta succedendo
// adesso, che è la domanda a cui serve rispondere per decidere se aprire un altro sportello. Si
// aggiornano da soli ogni dieci secondi, dalla stessa lettura che alimenta gli sportelli.
//
// L'attesa media è contata da quando il cliente ha dichiarato l'arrivo, non dall'orario di
// prenotazione: quello dice quando era atteso, non da quanto sta aspettando davvero. Se nessuno
// si è ancora annunciato resta un trattino, perché una media inventata è peggio di un buco.
import { useQuery } from '@tanstack/react-query';
import { TableSkeleton } from '@/components/ui/skeleton';
import { fetchAssistance } from '@/lib/api-client/client';
import { cn } from '@/lib/utils/cn';

/** Sopra questa attesa media il riquadro si colora: la fila fuori si sta allungando. */
const ATTESA_DA_GUARDARE = 20;

function Numero({
  etichetta,
  valore,
  dettaglio,
  tono = 'neutro',
}: {
  readonly etichetta: string;
  readonly valore: string;
  readonly dettaglio: string;
  readonly tono?: 'neutro' | 'attenzione';
}) {
  return (
    <div
      className={cn(
        'rounded-lg border px-4 py-3',
        tono === 'attenzione' ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white',
      )}
    >
      <dt className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{etichetta}</dt>
      <dd className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{valore}</dd>
      <p className="text-xs text-slate-500">{dettaglio}</p>
    </div>
  );
}

export function LiveQueuePanel() {
  const query = useQuery({
    queryKey: ['admin-assistance'] as const,
    queryFn: fetchAssistance,
    refetchInterval: 10_000,
  });
  const live = query.data?.live;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">La fila adesso</h2>
        <p className="text-xs text-slate-500">si aggiorna da solo ogni 10 secondi</p>
      </div>

      {query.isPending || live === undefined ? (
        <TableSkeleton rows={1} columns={4} label="Caricamento della fila" />
      ) : (
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Numero
            etichetta="Auto in fila"
            valore={String(live.inQueue)}
            dettaglio={
              live.inQueue === 0
                ? 'nessuno sta aspettando'
                : `${live.announced} hanno dichiarato di essere arrivate`
            }
          />
          <Numero
            etichetta="Attesa media ora"
            valore={live.averageWaitMinutes === null ? '—' : `${live.averageWaitMinutes} min`}
            dettaglio={
              live.averageWaitMinutes === null
                ? 'nessuno si è ancora annunciato'
                : `da quando hanno dichiarato l'arrivo · su ${live.announced} auto`
            }
            tono={
              live.averageWaitMinutes !== null && live.averageWaitMinutes >= ATTESA_DA_GUARDARE
                ? 'attenzione'
                : 'neutro'
            }
          />
          <Numero
            etichetta="Attesa più lunga"
            valore={live.longestWaitMinutes === null ? '—' : `${live.longestWaitMinutes} min`}
            dettaglio={
              live.longestWaitMinutes === null
                ? 'nessuna auto annunciata in fila'
                : 'il cliente che aspetta da più tempo'
            }
            tono={
              live.longestWaitMinutes !== null && live.longestWaitMinutes >= ATTESA_DA_GUARDARE * 2
                ? 'attenzione'
                : 'neutro'
            }
          />
          <Numero
            etichetta="Agli sportelli"
            valore={String(live.inProgress)}
            dettaglio={
              live.inProgress === 0 ? 'nessuna accettazione in corso' : 'pratiche in lavorazione'
            }
          />
        </dl>
      )}
    </section>
  );
}
