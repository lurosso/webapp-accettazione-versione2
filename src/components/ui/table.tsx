// Tabella con contenitore a scorrimento orizzontale (mai scroll dell'intera pagina).
//
// Le spaziature seguono la densità: la stessa coda si guarda al banco con il mouse e sul piazzale
// con il tablet in mano. `riga` vale 56 px al banco e 68 col dito, ed è un minimo, non un'altezza
// fissa: una riga con due righe di testo cresce. `testo-corpo` fa lo stesso con la scala.
import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('testo-corpo w-full caption-bottom', className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        // L'intestazione non è una riga da toccare: non prende l'altezza minima delle altre.
        'bg-surface-sunken text-ink-muted testo-nota tracking-wide uppercase [&_tr]:h-auto',
        className,
      )}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-line-subtle divide-y', className)} {...props} />;
}

export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  // `touch-manipulation` toglie il ritardo di 300 ms del doppio tocco sui browser mobili.
  return <tr className={cn('riga transizione touch-manipulation', className)} {...props} />;
}

export function TableHead({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn('px-4 py-3 text-left font-semibold whitespace-nowrap', className)}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-4 py-3 align-middle', className)} {...props} />;
}
