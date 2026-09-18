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
import { Badge } from '@/components/ui/badge';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { fetchAssistance } from '@/lib/api-client/client';
import { cn } from '@/lib/utils/cn';

/** Sopra questa attesa media il riquadro si colora: la fila fuori si sta allungando. */
const ATTESA_DA_GUARDARE = 20;

function Numero({
  etichetta,
  valore,
  dettaglio,
  consiglio,
  tono = 'neutro',
}: {
  readonly etichetta: string;
  readonly valore: string;
  readonly dettaglio: string;
  /** Cosa farne, quando il numero chiede di fare qualcosa. Un dato senza soglia è solo un dato. */
  readonly consiglio?: string | undefined;
  readonly tono?: 'neutro' | 'attenzione';
}) {
  return (
    <div
      className={cn(
        'rounded-md border px-5 py-4',
        tono === 'attenzione'
          ? 'border-priority-now bg-priority-now-soft'
          : 'border-line-subtle bg-surface',
      )}
    >
      <dt className="text-ink-muted text-xs font-semibold tracking-wide uppercase">{etichetta}</dt>
      <dd className="text-ink mt-1.5 font-mono text-3xl font-semibold tabular-nums">{valore}</dd>
      <p className="text-ink-muted mt-1 text-xs">{dettaglio}</p>
      {consiglio !== undefined ? (
        <p className="text-priority-now-ink mt-1.5 text-xs font-semibold">{consiglio}</p>
      ) : null}
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
    <Panel>
      <PanelHeader
        title="La fila adesso"
        description="Cosa sta succedendo in questo momento, non com'è andata: sono i numeri su cui si decide se aprire un altro sportello."
        meta={
          <Badge tone="success" dot>
            in diretta · ogni 10 secondi
          </Badge>
        }
      />

      {query.isPending || live === undefined ? (
        <TableSkeleton rows={1} columns={4} label="Caricamento della fila" />
      ) : (
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
            consiglio={
              live.averageWaitMinutes !== null && live.averageWaitMinutes >= ATTESA_DA_GUARDARE
                ? `sopra i ${ATTESA_DA_GUARDARE}: valuta un altro sportello`
                : undefined
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
                : [live.longestWaitCustomer, live.longestWaitCode].filter(Boolean).join(' · ')
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
    </Panel>
  );
}
