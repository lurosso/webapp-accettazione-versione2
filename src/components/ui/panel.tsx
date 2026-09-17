// Pannello: il contenitore delle sezioni di una pagina densa (amministrazione, BDC, sistema).
//
// Esisteva già, ma copiato a mano: `rounded-xl border border-slate-200 bg-white p-4 shadow-sm
// sm:p-6` era ripetuto in sei file, e bastava che uno dei sei venisse scritto con `p-5` o
// `border-slate-300` perché la pagina sembrasse montata con pezzi di due lotti diversi. Qui è un
// posto solo, e l'intestazione (titolo, spiegazione, azione) ha sempre la stessa forma.
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

export function Panel({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn(
        'border-line-subtle bg-surface rounded-lg border p-5 shadow-sm sm:p-6',
        className,
      )}
      {...props}
    />
  );
}

export interface PanelHeaderProps {
  readonly title: string;
  /** Una riga che dice a cosa serve il pannello, nelle parole di chi lo usa. */
  readonly description?: ReactNode;
  /** Comandi del pannello: vanno a destra e a capo sugli schermi stretti. */
  readonly actions?: ReactNode;
  /** Stato o conteggio accanto al titolo (una `Badge`, un numero). */
  readonly meta?: ReactNode;
  readonly className?: string | undefined;
}

export function PanelHeader({ title, description, actions, meta, className }: PanelHeaderProps) {
  return (
    <div className={cn('mb-5 flex flex-wrap items-start justify-between gap-4', className)}>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-ink text-lg font-semibold tracking-tight">{title}</h2>
          {meta}
        </div>
        {description !== undefined ? (
          <p className="text-ink-soft max-w-prose text-sm">{description}</p>
        ) : null}
      </div>
      {actions !== undefined ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
