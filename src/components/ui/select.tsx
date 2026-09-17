// Select nativa stilizzata: accessibile, funziona su tablet e kiosk senza JavaScript aggiuntivo.
import type { SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        // min-h-touch = 44 px: bersaglio minimo per il tocco su tablet, uguale per PC.
        'controllo border-line bg-surface text-ink testo-corpo w-full rounded-md border px-3.5 shadow-xs',
        'transizione focus-anello',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
