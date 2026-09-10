// Banner informativo con tono (info, warning, error, success), titolo e azioni opzionali.
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

export type AlertTone = 'info' | 'warning' | 'error' | 'success';

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  readonly tone?: AlertTone;
  readonly title: string;
  readonly actions?: ReactNode;
}

const TONE_CLASSES: Record<AlertTone, string> = {
  info: 'border-sky-200 bg-sky-50 text-sky-900',
  warning: 'border-amber-300 bg-status-in-progress-soft text-amber-900',
  error: 'border-red-300 bg-status-no-show-soft text-red-900',
  success: 'border-emerald-200 bg-status-completed-soft text-emerald-900',
};

export function Alert({
  tone = 'info',
  title,
  actions,
  children,
  className,
  ...props
}: AlertProps) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex flex-col gap-3 rounded-lg border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between',
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    >
      <div className="flex flex-col gap-0.5">
        <p className="font-semibold">{title}</p>
        {children !== undefined && children !== null ? (
          <div className="text-inherit/80">{children}</div>
        ) : null}
      </div>
      {actions !== undefined && actions !== null ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
