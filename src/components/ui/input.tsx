// Campo di testo.
import type { InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-xs',
        'placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
