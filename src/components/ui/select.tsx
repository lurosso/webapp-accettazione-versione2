// Select nativa stilizzata: accessibile, funziona su tablet e kiosk senza JavaScript aggiuntivo.
import type { SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        // min-h-11 = 44 px: bersaglio minimo per il tocco su tablet, uguale per PC.
        'min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-xs',
        'focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
