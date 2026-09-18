'use client';

// Pulsanti d'azione rapida per riga, mostrati in base alle transizioni ammesse dalla state machine
// (mai disabilitati da guasti esterni: solo dalle regole e dall'azione in corso sulla stessa riga).
//
// Una pratica presa in carico ha un solo comando, "Completato": nulla che la faccia sparire dalla
// coda con un tocco. Rimetterla in attesa resta possibile, ma dall'assistenza in amministrazione.
//
// Le azioni di routine (prendi in carico, salta, completato) restano a un solo tocco: si fanno
// decine di volte al giorno e una finestra di conferma le renderebbe insopportabili. Si disfano
// dall'avviso «Annulla» che compare in basso per cinque secondi (`UndoToast` nella dashboard).
//
// "Segna assente" è di un'altra natura: genera un lead per il BDC e un evento verso il CRM, cioè
// ESCE DALL'OFFICINA, e solo un responsabile può riaprire la pratica. È il livello più alto della
// scala delle conferme e vuole il gesto più deliberato: si scorre (`SlideToConfirm`).
//
// Lo scorrimento non sta sempre aperto nella riga — occuperebbe la larghezza di tre comandi su
// ogni riga in ritardo. Il pulsante compatto resta, e quando lo si preme la riga di comandi
// diventa il cursore: chi l'ha sfiorato per sbaglio si trova davanti un cursore fermo, che non fa
// niente da solo.
import { useState } from 'react';
import { canTransition } from '@/domain/appointment-state-machine';
import { isInQueue, type Appointment } from '@/domain/entities/appointment';
import { Button, type ButtonVariant } from '@/components/ui/button';
import { SlideToConfirm, type SlideTone } from '@/components/ui/slide-to-confirm';
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

interface ActionSpec {
  readonly action: AppointmentAction;
  readonly label: string;
  /** Nome per esteso, quando l'etichetta visibile è abbreviata per stare nella riga. */
  readonly fullLabel?: string;
  readonly variant: ButtonVariant;
  /** Esce dall'officina: al posto del tocco, un cursore da portare in fondo. */
  readonly slide?: { readonly label: string; readonly tone: SlideTone };
}

export function ActionButtons({
  appointment,
  pending,
  foreignDesk,
  late = false,
  onAction,
}: ActionButtonsProps) {
  const [daScorrere, setDaScorrere] = useState<ActionSpec | null>(null);
  const { status } = appointment;
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
      slide: { label: 'Scorri per segnare il cliente assente', tone: 'destructive' },
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

  // Chiesto il livello 2, la riga diventa il cursore: un comando solo, tutta la larghezza, e la
  // via d'uscita accanto. Mostrare cursore e pulsanti insieme darebbe due strade per la stessa
  // cosa, e una delle due sarebbe quella che volevamo rendere difficile.
  if (daScorrere !== null && daScorrere.slide !== undefined) {
    // `flex-wrap`: quando la colonna si stringe va a capo «Annulla», non il cursore — che ha una
    // larghezza minima propria, perché sotto una certa misura non c'è più un gesto da fare.
    return (
      <div className="flex w-full flex-wrap items-center justify-end gap-2">
        <SlideToConfirm
          className="flex-1"
          tone={daScorrere.slide.tone}
          label={daScorrere.slide.label}
          actionLabel={`${daScorrere.fullLabel ?? daScorrere.label} pratica ${appointment.code}`}
          pending={pending}
          onConfirm={() => onAction(daScorrere.action)}
          data-testid={`scorri-${daScorrere.action}`}
        />
        <Button variant="ghost" size="sm" onClick={() => setDaScorrere(null)}>
          Annulla
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {buttons.map((b) => (
        <Button
          key={b.action}
          size="sm"
          variant={b.variant}
          disabled={pending}
          onClick={() => (b.slide === undefined ? onAction(b.action) : setDaScorrere(b))}
          aria-label={`${b.fullLabel ?? b.label} pratica ${appointment.code}`}
        >
          {b.label}
        </Button>
      ))}
    </div>
  );
}
