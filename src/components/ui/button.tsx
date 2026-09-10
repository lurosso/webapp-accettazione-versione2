// Pulsante base (convenzioni shadcn/ui, codice nel repo, nessun lock-in).
// Target touch minimo 3rem (`size="lg"`) per tablet e postazioni con schermo touch.
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

export type ButtonVariant =
  'default' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'success' | 'warning';

export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  default: 'bg-slate-900 text-white hover:bg-slate-700 focus-visible:ring-slate-500',
  secondary: 'bg-slate-100 text-slate-900 hover:bg-slate-200 focus-visible:ring-slate-400',
  outline:
    'border border-slate-300 bg-white text-slate-900 hover:bg-slate-50 focus-visible:ring-slate-400',
  ghost: 'text-slate-700 hover:bg-slate-100 focus-visible:ring-slate-400',
  destructive: 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-400',
  success: 'bg-status-completed text-white hover:brightness-95 focus-visible:ring-emerald-400',
  warning: 'bg-status-in-progress text-slate-900 hover:brightness-95 focus-visible:ring-amber-400',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-touch px-5 text-base',
};

export function Button({
  className,
  variant = 'default',
  size = 'md',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors',
        'focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    />
  );
}
