'use client';

// Interruttore acceso/spento, da toccare con un dito: bersaglio alto quanto un controllo,
// etichetta cliccabile, stato letto dagli screen reader (`role="switch"`, `aria-checked`).
// Serve ai filtri che si accendono e si spengono, non alle scelte fra più valori.
import { cn } from '@/lib/utils/cn';

export interface SwitchProps {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly label: string;
  /** Riga sotto l'etichetta: cosa cambia quando è acceso. */
  readonly description?: string;
  readonly disabled?: boolean;
  readonly testId?: string;
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  testId,
}: SwitchProps) {
  return (
    // Il `label` intorno al bottone: toccare il testo vale come toccare l'interruttore.
    <label
      className={cn(
        'controllo flex items-center gap-3 select-none',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        data-testid={testId}
        onClick={() => onChange(!checked)}
        className={cn(
          'premibile focus-anello relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border',
          checked ? 'bg-brand-secondary border-brand-secondary' : 'bg-surface-sunken border-line',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'bg-surface transizione absolute top-0.5 left-0.5 size-6 rounded-full shadow-sm',
            checked ? 'translate-x-5' : 'translate-x-0',
          )}
        />
      </button>
      <span className="flex flex-col leading-tight">
        <span className="testo-corpo font-semibold">{label}</span>
        {description !== undefined ? (
          <span className="testo-nota text-ink-muted">{description}</span>
        ) : null}
      </span>
    </label>
  );
}
