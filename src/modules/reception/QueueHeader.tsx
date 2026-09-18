'use client';

// Testata della coda: quale coda si sta guardando, e come sta andando.
//
// Erano un menu a tendina e due pulsanti che si accendevano a vicenda («Vista globale», poi
// «Torna al mio sportello»): tre comandi per una scelta sola, e l'etichetta che cambiava sotto il
// dito. Adesso sono tre schede — la mia, tutte, riconsegne — e si vede quale è attiva senza
// leggere, che è come funziona una scelta fra tre cose.
//
// Sotto, i quattro numeri della giornata. Erano una frase («24 in coda, 0 in carico, 0
// completate»): una frase si legge, quattro numeri si guardano. Ognuno ha la riga di colore del
// proprio stato, così l'occhio sa dove tornare senza rileggere l'etichetta.
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils/cn';

export type QueueView = 'desk' | 'global' | 'returns';

export interface QueueCounter {
  readonly etichetta: string;
  readonly valore: number;
  /** Riga di colore sotto il numero: è lo stato, non una decorazione. */
  readonly riga: string;
}

export interface QueueHeaderProps {
  readonly title: string;
  readonly subtitle: string;
  readonly view: QueueView;
  readonly returnsCount: number;
  readonly counters: readonly QueueCounter[];
  readonly onView: (view: QueueView) => void;
  /** Sportelli selezionabili quando si guarda il proprio: null quando non c'è scelta. */
  readonly deskPicker?: {
    readonly value: string;
    readonly options: readonly { readonly id: string; readonly label: string }[];
    readonly onChange: (deskId: string) => void;
  } | null;
  readonly actions?: React.ReactNode;
  readonly badges?: React.ReactNode;
}

function Scheda({
  attiva,
  onClick,
  children,
  testId,
}: {
  readonly attiva: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
  readonly testId?: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={attiva}
      data-testid={testId}
      onClick={onClick}
      className={cn(
        'controllo transizione focus-anello premibile testo-corpo flex-1 rounded-md px-5 font-semibold whitespace-nowrap',
        attiva ? 'bg-surface text-ink shadow-xs' : 'text-ink-soft hover:bg-surface/60',
      )}
    >
      {children}
    </button>
  );
}

export function QueueHeader({
  title,
  subtitle,
  view,
  returnsCount,
  counters,
  onView,
  deskPicker = null,
  actions,
  badges,
}: QueueHeaderProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="text-ink-soft testo-corpo">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {badges}
          {actions}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div
          role="tablist"
          aria-label="Quale coda"
          className="bg-surface-sunken flex min-w-0 flex-1 gap-1 rounded-lg p-1"
        >
          <Scheda attiva={view === 'desk'} onClick={() => onView('desk')}>
            Il mio sportello
          </Scheda>
          <Scheda attiva={view === 'global'} onClick={() => onView('global')}>
            Tutti gli sportelli
          </Scheda>
          <Scheda
            attiva={view === 'returns'}
            onClick={() => onView('returns')}
            testId="scheda-riconsegne"
          >
            Riconsegne {returnsCount > 0 ? `(${returnsCount})` : ''}
          </Scheda>
        </div>
        {/* Il menu degli sportelli resta, ma solo dove serve: dentro la scheda del proprio. */}
        {view === 'desk' && deskPicker !== null && deskPicker.options.length > 1 ? (
          <Select
            className="w-auto min-w-52"
            value={deskPicker.value}
            onChange={(event) => deskPicker.onChange(event.target.value)}
            aria-label="Sportello visualizzato"
          >
            {deskPicker.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        ) : null}
      </div>

      {counters.length > 0 ? (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {counters.map((c) => (
            <div
              key={c.etichetta}
              className="border-line bg-surface flex flex-col gap-1 rounded-md border px-4 py-3"
            >
              <span className="flex items-baseline gap-2">
                <dt className="sr-only">{c.etichetta}</dt>
                <dd className="testo-codice font-mono font-bold tabular-nums">{c.valore}</dd>
                <span className="text-ink-soft testo-nota font-semibold">{c.etichetta}</span>
              </span>
              <span aria-hidden="true" className={cn('h-1 rounded-full', c.riga)} />
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

/** Ri-esportato per comodità di chi compone la testata. */
export { Badge, Button };
