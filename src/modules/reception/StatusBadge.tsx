// Badge dello stato della pratica con i token colore del tema e testo in italiano.
//
// Pastiglia chiara più pallino pieno, uguale per tutti e sei gli stati. Prima due stati su sei
// erano pieni (`In carico` giallo, `Completata` verde su bianco) e quattro chiari: a colpo d'occhio
// sembravano cose di natura diversa, mentre sono sei valori dello stesso campo. Il pallino è anche
// il residuo leggibile quando il colore non arriva — report stampato, monitor scarico, daltonismo.
import type { AppointmentStatus } from '@/domain/entities/appointment';
import { cn } from '@/lib/utils/cn';

export const STATUS_LABELS: Record<AppointmentStatus, string> = {
  WAITING: 'In attesa',
  IN_PROGRESS: 'In carico',
  SKIPPED: 'Saltata',
  COMPLETED: 'Completata',
  NO_SHOW: 'No-show',
  CANCELLED: 'Annullata',
};

const STATUS_CLASSES: Record<AppointmentStatus, string> = {
  WAITING: 'bg-status-waiting-soft text-status-waiting-ink',
  IN_PROGRESS: 'bg-status-in-progress-soft text-status-in-progress-ink',
  SKIPPED: 'bg-status-skipped-soft text-status-skipped-ink',
  COMPLETED: 'bg-status-completed-soft text-status-completed-ink',
  NO_SHOW: 'bg-status-no-show-soft text-status-no-show-ink',
  CANCELLED: 'bg-status-cancelled-soft text-status-cancelled-ink line-through',
};

const DOT_CLASSES: Record<AppointmentStatus, string> = {
  WAITING: 'bg-status-waiting',
  IN_PROGRESS: 'bg-status-in-progress',
  SKIPPED: 'bg-status-skipped',
  COMPLETED: 'bg-status-completed',
  NO_SHOW: 'bg-status-no-show',
  CANCELLED: 'bg-status-cancelled',
};

export function StatusBadge({
  status,
  className,
}: {
  readonly status: AppointmentStatus;
  readonly className?: string;
}) {
  return (
    <span
      title={status}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap',
        STATUS_CLASSES[status],
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn('size-2 shrink-0 rounded-full', DOT_CLASSES[status])}
      />
      {STATUS_LABELS[status]}
    </span>
  );
}
