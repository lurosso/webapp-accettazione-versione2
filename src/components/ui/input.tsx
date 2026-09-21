// Campo di testo. Altezza 44 px: è un bersaglio da toccare, non solo una casella da riempire.
import type { InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'controllo border-line bg-surface text-ink testo-corpo w-full rounded-md border px-3.5 shadow-xs',
        // Il segnaposto è testo: `slate-400` dava 3,2:1 e a mezzo metro non si leggeva.
        'placeholder:text-ink-muted',
        'transizione focus-anello',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
