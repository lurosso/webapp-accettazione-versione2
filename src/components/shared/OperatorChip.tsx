// Identità di un operatore mostrata sempre nello stesso modo: iniziali in evidenza più nome.
// Usato nell'intestazione (chi è collegato) e nella coda (chi ha preso in carico la pratica),
// così l'accettatore riconosce a colpo d'occhio le proprie pratiche e quelle dei colleghi.
import type { OperatorRole } from '@/domain/entities/operator';
import { cn } from '@/lib/utils/cn';

export const ROLE_LABELS: Record<OperatorRole, string> = {
  ADVISOR: 'Accettatore',
  SUPERVISOR: 'Responsabile',
  ADMIN: 'Amministratore',
};

/** Iniziali del nome (al massimo due lettere), es. "Mario Rossi" → "MR". */
export function operatorInitials(displayName: string): string {
  const parts = displayName
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0);
  const letters = parts.slice(0, 2).map((p) => p[0] ?? '');
  return letters.join('').toUpperCase() || '?';
}

export interface OperatorChipProps {
  readonly displayName: string;
  readonly role?: OperatorRole | undefined;
  /** Evidenzia l'operatore collegato: le sue pratiche si distinguono da quelle dei colleghi. */
  readonly isCurrent?: boolean;
  readonly size?: 'sm' | 'md';
  /** `light` sui fondi scuri (intestazione blu del marchio): altrimenti il ruolo non si legge. */
  readonly tone?: 'dark' | 'light';
  readonly className?: string | undefined;
}

export function OperatorChip({
  displayName,
  role,
  isCurrent = false,
  size = 'sm',
  tone = 'dark',
  className,
}: OperatorChipProps) {
  const big = size === 'md';
  const chiaro = tone === 'light';
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-full font-bold',
          big ? 'h-9 w-9 text-sm' : 'h-7 w-7 text-xs',
          chiaro
            ? 'text-brand-blue-dark bg-white'
            : isCurrent
              ? 'bg-brand-blue text-white'
              : 'bg-slate-200 text-slate-700',
        )}
      >
        {operatorInitials(displayName)}
      </span>
      <span className="flex flex-col leading-tight">
        <span className={cn('text-sm font-semibold', chiaro ? 'text-white' : 'text-slate-900')}>
          {displayName}
          {isCurrent ? (
            <span className={cn('ml-1 font-normal', chiaro ? 'text-white/70' : 'text-slate-500')}>
              (tu)
            </span>
          ) : null}
        </span>
        {role !== undefined ? (
          <span className={cn('text-xs', chiaro ? 'text-white/70' : 'text-slate-500')}>
            {ROLE_LABELS[role]}
          </span>
        ) : null}
      </span>
    </span>
  );
}
