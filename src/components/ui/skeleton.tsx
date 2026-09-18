// Segnaposto animato mostrato mentre i dati arrivano.
// Ripete la forma di ciò che sta per comparire (righe di tabella, schede), così l'occhio sa già
// dove guardare e la pagina non "salta" quando i dati sostituiscono il segnaposto. È preferibile
// a una scritta "Caricamento…" perché non sposta nulla e non chiede di essere letta.
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-line/80', className)}
      {...props}
    />
  );
}

/** Righe di una tabella in caricamento: `rows` righe, `columns` celle ciascuna. */
export function TableSkeleton({
  rows = 5,
  columns = 6,
  label = 'Caricamento in corso',
}: {
  readonly rows?: number;
  readonly columns?: number;
  /** Testo per gli screen reader: il segnaposto in sé non dice nulla. */
  readonly label?: string;
}) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-3 rounded-md bg-white px-4 py-3">
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton
              key={c}
              className={cn('h-4', c === 0 ? 'w-14' : c === columns - 1 ? 'w-28' : 'flex-1')}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Schede alte in caricamento (elenchi da tablet). */
export function CardSkeleton({
  count = 3,
  label = 'Caricamento in corso',
}: {
  readonly count?: number;
  readonly label?: string;
}) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-2xl border-2 border-line bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-3 w-48" />
            </div>
            <Skeleton className="h-12 w-40 rounded-xl" />
          </div>
        </div>
      ))}
    </div>
  );
}
