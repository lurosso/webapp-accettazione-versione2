// Badge dello stato della pratica con i token colore del tema e testo in italiano.
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
  WAITING: 'bg-status-waiting-soft text-slate-700 ring-slate-300',
  IN_PROGRESS: 'bg-status-in-progress text-slate-900 ring-amber-400',
  SKIPPED: 'bg-status-skipped-soft text-orange-900 ring-orange-300',
  COMPLETED: 'bg-status-completed text-white ring-emerald-500',
  NO_SHOW: 'bg-status-no-show-soft text-red-800 ring-red-300',
  CANCELLED: 'bg-status-cancelled-soft text-slate-600 ring-slate-300 line-through',
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
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ring-1',
        STATUS_CLASSES[status],
        className,
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
