// Etichetta compatta (stato, ruolo, marchio), con pallino opzionale.
//
// Il pallino non è decorazione: è il residuo leggibile quando il colore non arriva (stampa in
// bianco e nero del report, monitor scarico, daltonismo). Il testo della pastiglia usa i token
// `-ink`, tarati per superare 7:1 sul proprio fondo `-soft`; prima ogni tono si arrangiava con un
// colore Tailwind vicino e venivano fuori cinque famiglie diverse per cinque toni della stessa cosa.
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: BadgeTone;
  /** Aggiunge il pallino pieno del tono davanti al testo. */
  readonly dot?: boolean;
}

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-sunken text-ink-soft',
  info: 'bg-status-info-soft text-status-info-ink',
  success: 'bg-status-completed-soft text-status-completed-ink',
  warning: 'bg-status-in-progress-soft text-status-in-progress-ink',
  danger: 'bg-status-no-show-soft text-status-no-show-ink',
};

const DOT_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-status-waiting',
  info: 'bg-status-info',
  success: 'bg-status-completed',
  warning: 'bg-status-in-progress',
  danger: 'bg-status-no-show',
};

export function Badge({
  className,
  tone = 'neutral',
  dot = false,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 testo-nota font-semibold whitespace-nowrap',
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    >
      {dot ? (
        <span
          aria-hidden="true"
          className={cn('size-2 shrink-0 rounded-full', DOT_CLASSES[tone])}
        />
      ) : null}
      {children}
    </span>
  );
}
