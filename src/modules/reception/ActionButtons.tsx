'use client';

// Pulsanti d'azione rapida per riga, mostrati in base alle transizioni ammesse dalla state machine
// (mai disabilitati da guasti esterni: solo dalle regole e dall'azione in corso sulla stessa riga).
import { canTransition } from '@/domain/appointment-state-machine';
import type { Appointment } from '@/domain/entities/appointment';
import { Button } from '@/components/ui/button';
import type { AppointmentAction } from './types';

export interface ActionButtonsProps {
  readonly appointment: Appointment;
  readonly pending: boolean;
  /** True quando la pratica appartiene a un altro sportello (vista globale). */
  readonly foreignDesk: boolean;
  readonly onAction: (action: AppointmentAction) => void;
}

export function ActionButtons({ appointment, pending, foreignDesk, onAction }: ActionButtonsProps) {
  const { status } = appointment;
  const buttons: {
    readonly action: AppointmentAction;
    readonly label: string;
    readonly variant: 'warning' | 'success' | 'outline' | 'ghost';
  }[] = [];

  if (canTransition(status, 'IN_PROGRESS')) {
    buttons.push({
      action: 'take',
      label: foreignDesk ? 'Prendi in carico (altro sportello)' : 'Prendi in carico',
      variant: 'warning',
    });
  }
  if (status === 'WAITING' && canTransition(status, 'SKIPPED')) {
    buttons.push({ action: 'skip', label: 'Salta', variant: 'outline' });
  }
  if (status === 'SKIPPED' && canTransition(status, 'WAITING')) {
    buttons.push({ action: 'restore', label: 'Ripristina', variant: 'ghost' });
  }
  if (status === 'IN_PROGRESS') {
    if (canTransition(status, 'COMPLETED')) {
      buttons.push({ action: 'complete', label: 'Completato', variant: 'success' });
    }
    if (canTransition(status, 'WAITING')) {
      buttons.push({ action: 'release', label: 'Rilascia', variant: 'ghost' });
    }
  }

  if (buttons.length === 0) {
    return <span className="text-xs text-slate-400">—</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {buttons.map((b) => (
        <Button
          key={b.action}
          size="sm"
          variant={b.variant}
          disabled={pending}
          onClick={() => onAction(b.action)}
          aria-label={`${b.label} pratica ${appointment.code}`}
        >
          {b.label}
        </Button>
      ))}
    </div>
  );
}
