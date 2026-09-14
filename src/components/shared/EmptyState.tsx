// Stato vuoto: cosa si vede quando un elenco non ha nulla da mostrare.
// Un elenco vuoto non è un errore, e non deve sembrarlo: dice cosa manca e, quando ha senso, cosa
// si può fare (sincronizzare, cambiare vista). Lo stesso componente ovunque, così l'operatore
// impara a riconoscerlo a colpo d'occhio e non lo confonde con un caricamento che non finisce.
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

export interface EmptyStateProps {
  readonly title: string;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  /** `compact` dentro le sezioni di una tabella, `page` quando occupa da solo l'area. */
  readonly size?: 'compact' | 'page';
  readonly className?: string | undefined;
}

export function EmptyState({
  title,
  description,
  actions,
  size = 'compact',
  className,
}: EmptyStateProps) {
  const page = size === 'page';
  return (
    <div
      role="status"
      className={cn(
        'rounded-xl border border-dashed border-slate-300 bg-white text-center',
        page ? 'px-6 py-12' : 'px-4 py-6',
        className,
      )}
    >
      <p className={cn('font-semibold text-slate-800', page ? 'text-lg' : 'text-sm')}>{title}</p>
      {description !== undefined ? (
        <p className={cn('mt-1 text-slate-600', page ? 'text-sm' : 'text-xs')}>{description}</p>
      ) : null}
      {actions !== undefined ? (
        <div className="mt-4 flex flex-wrap justify-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
