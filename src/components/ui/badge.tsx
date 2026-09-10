// Etichetta compatta (stato, ruolo, marchio).
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: BadgeTone;
}

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-300',
  info: 'bg-sky-100 text-sky-800 ring-sky-300',
  success: 'bg-status-completed-soft text-emerald-800 ring-emerald-300',
  warning: 'bg-status-in-progress-soft text-amber-900 ring-amber-300',
  danger: 'bg-status-no-show-soft text-red-800 ring-red-300',
};

export function Badge({ className, tone = 'neutral', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ring-1',
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    />
  );
}
