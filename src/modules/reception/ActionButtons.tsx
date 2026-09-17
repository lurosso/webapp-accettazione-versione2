'use client';

// Pulsanti d'azione rapida per riga, mostrati in base alle transizioni ammesse dalla state machine
// (mai disabilitati da guasti esterni: solo dalle regole e dall'azione in corso sulla stessa riga).
//
// Una pratica presa in carico ha un solo comando, "Completato": nulla che la faccia sparire dalla
// coda con un tocco. Rimetterla in attesa resta possibile, ma dall'assistenza in amministrazione.
//
// Le azioni di routine (prendi in carico, salta, completato) restano a un solo tocco: si fanno
// decine di volte al giorno e una finestra di conferma le renderebbe insopportabili. "Segna
// assente" è diverso: genera un lead per il BDC e un evento verso il CRM, e solo un responsabile
// può riaprire la pratica. Per questo chiede un secondo tocco sullo stesso pulsante — una
// conferma in linea, non una finestra — che dopo pochi secondi torna da sola allo stato iniziale.
import { useEffect, useState } from 'react';
import { canTransition } from '@/domain/appointment-state-machine';
import { isInQueue, type Appointment } from '@/domain/entities/appointment';
import { Button, type ButtonVariant } from '@/components/ui/button';
import type { AppointmentAction } from './types';

export interface ActionButtonsProps {
  readonly appointment: Appointment;
  readonly pending: boolean;
  /** True quando la pratica appartiene a un altro sportello (vista globale). */
  readonly foreignDesk: boolean;
  /**
   * Riga del blocco "in ritardo": aggiunge le due decisioni che l'accettatore deve prendere su
   * chi non si è presentato in orario. Fuori da quel blocco non compaiono, per non affollare la
   * riga di un cliente che sta semplicemente aspettando il suo turno.
   */
  readonly late?: boolean;
  readonly onAction: (action: AppointmentAction) => void;
}

/** Azioni che richiedono il secondo tocco, con il testo mostrato in attesa della conferma. */
const CONFIRM_LABELS: Partial<Record<AppointmentAction, string>> = {
  'no-show': 'Confermi assente?',
};

/** Dopo quanto la richiesta di conferma decade da sola. */
const CONFIRM_TIMEOUT_MS = 6_000;

interface ActionSpec {
  readonly action: AppointmentAction;
  readonly label: string;
  /** Nome per esteso, quando l'etichetta visibile è abbreviata per stare nella riga. */
  readonly fullLabel?: string;
  readonly variant: ButtonVariant;
}

export function ActionButtons({
  appointment,
  pending,
  foreignDesk,
  late = false,
  onAction,
}: ActionButtonsProps) {
  const { status } = appointment;
  const [confirming, setConfirming] = useState<AppointmentAction | null>(null);

  // La conferma non deve restare appesa: se l'accettatore si distrae, il pulsante torna normale.
  useEffect(() => {
    if (confirming === null) {
      return undefined;
    }
    const timer = setTimeout(() => setConfirming(null), CONFIRM_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [confirming]);

  const buttons: ActionSpec[] = [];

  // Solo dalla coda: una pratica completata torna in carico dal dettaglio ("Riapri pratica"), non
  // con un "Prendi in carico" che qui vorrebbe dire un'altra cosa.
  if (isInQueue(status) && canTransition(status, 'IN_PROGRESS')) {
    buttons.push({
      action: 'take',
      label: foreignDesk ? 'Prendi in carico (altro sportello)' : 'Prendi in carico',
      // Blu: è un'azione di lavoro, non un completamento.
      variant: 'default',
    });
  }
  if (late) {
    // Le due decisioni sul cliente in ritardo: è arrivato e lo rimettiamo in coda, oppure è
    // assente e il BDC lo ricontatterà.
    // Etichette corte: nella riga in ritardo convivono con «Prendi in carico», e tre comandi per
    // esteso si impilavano uno sotto l'altro. Il nome completo resta nell'`aria-label`.
    buttons.push({
      action: 'reschedule',
      label: 'In coda',
      fullLabel: 'Rimetti in coda',
      variant: 'outline',
    });
    buttons.push({
      action: 'no-show',
      label: 'Assente',
      fullLabel: 'Segna assente',
      variant: 'destructiveQuiet',
    });
  } else {
    if (status === 'WAITING' && canTransition(status, 'SKIPPED')) {
      buttons.push({ action: 'skip', label: 'Salta', variant: 'outline' });
    }
    if (status === 'SKIPPED' && canTransition(status, 'WAITING')) {
      buttons.push({ action: 'restore', label: 'Ripristina', variant: 'ghost' });
    }
  }
  if (status === 'IN_PROGRESS' && canTransition(status, 'COMPLETED')) {
    // Solo "Completato". "Rilascia" è stato tolto dalla riga (2026-09-17): riportava la pratica
    // in coda svuotando operatore e sportello, stava accanto al pulsante verde ed era un tocco
    // involontario a un centimetro di distanza. Una presa in carico sbagliata si sistema dal
    // pannello di assistenza, che è di responsabili e amministratori.
    buttons.push({ action: 'complete', label: 'Completato', variant: 'success' });
  }

  if (status === 'NO_SHOW' && canTransition(status, 'WAITING')) {
    // Il cliente segnato assente si è presentato: torna in coda dopo chi è già in attesa.
    buttons.push({
      action: 'reactivate',
      label: 'Riattiva / Arrivato in ritardo',
      variant: 'default',
    });
  }

  if (buttons.length === 0) {
    return <span className="text-ink-muted text-xs">—</span>;
  }

  const onClick = (spec: ActionSpec): void => {
    const richiedeConferma = CONFIRM_LABELS[spec.action] !== undefined;
    if (richiedeConferma && confirming !== spec.action) {
      setConfirming(spec.action);
      return;
    }
    setConfirming(null);
    onAction(spec.action);
  };

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {buttons.map((b) => {
        const inConferma = confirming === b.action;
        return (
          <Button
            key={b.action}
            size="sm"
            variant={inConferma ? 'destructive' : b.variant}
            disabled={pending}
            onClick={() => onClick(b)}
            aria-label={
              inConferma
                ? `Conferma: ${(b.fullLabel ?? b.label).toLowerCase()} pratica ${appointment.code}`
                : `${b.fullLabel ?? b.label} pratica ${appointment.code}`
            }
            className={inConferma ? 'ring-2 ring-red-300 ring-offset-1' : undefined}
          >
            {inConferma ? CONFIRM_LABELS[b.action] : b.label}
          </Button>
        );
      })}
      {confirming !== null ? (
        <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
          Annulla
        </Button>
      ) : null}
    </div>
  );
}
