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
  info: 'bg-sky-50 text-sky-900',
  warning: 'bg-status-in-progress-soft text-status-in-progress-ink',
  error: 'bg-status-no-show-soft text-status-no-show-ink',
  success: 'bg-status-completed-soft text-status-completed-ink',
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
        // Niente bordo: il fondo pieno basta a staccarlo, e un bordo colorato sopra un fondo
        // colorato è la doppia sottolineatura che rendeva pesante ogni avviso.
        'flex flex-col gap-3 rounded-md px-5 py-4 text-sm sm:flex-row sm:items-center sm:justify-between',
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    >
      <div className="flex flex-col gap-1">
        <p className="font-semibold">{title}</p>
        {children !== undefined && children !== null ? <div>{children}</div> : null}
      </div>
      {actions !== undefined && actions !== null ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
