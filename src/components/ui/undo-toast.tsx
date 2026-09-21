'use client';

// «Fatto — annulla», in basso, per cinque secondi.
//
// È la difesa delle azioni che si disfano: prendere in carico, saltare. Si fanno decine di volte
// al giorno e chiedere conferma ogni volta sarebbe insopportabile; ma un tocco sbagliato capita,
// e senza questo l'unico rimedio è aprire il dettaglio e cercare il comando inverso.
//
// Non trattiene la richiesta: l'azione è già partita e il server ha già risposto. «Annulla» manda
// l'azione contraria, che è una cosa che l'officina sa già fare (una pratica presa in carico si
// rimette in coda, una saltata si ripristina). Così non esiste uno stato intermedio in cui la coda
// mostra una cosa e il server ne sa un'altra — che con quattro postazioni sulla stessa fila
// sarebbe il modo più rapido per far litigare due colleghi.
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

/** Quanto resta a disposizione per cambiare idea. */
export const DURATA_ANNULLAMENTO_MS = 5_000;

export interface UndoToastProps {
  /** Cosa è appena successo, nelle parole dell'officina: «F014 presa in carico». */
  readonly message: string | null;
  readonly onUndo: () => void;
  readonly onDismiss: () => void;
  /** Vero mentre l'annullamento è in corso: il pulsante resta premuto. */
  readonly undoing?: boolean;
}

export function UndoToast({ message, onUndo, onDismiss, undoing = false }: UndoToastProps) {
  useEffect(() => {
    if (message === null) {
      return undefined;
    }
    const timer = setTimeout(onDismiss, DURATA_ANNULLAMENTO_MS);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  if (message === null) {
    return null;
  }

  return (
    <div
      // `status` e non `alert`: è una conferma, non un problema. Chi usa un lettore di schermo la
      // sente alla prima pausa, senza che gli venga interrotto quello che stava leggendo.
      role="status"
      aria-live="polite"
      className="animate-finestra bg-ink fixed inset-x-0 bottom-6 z-50 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-4 rounded-md py-2 pr-2 pl-5 text-white shadow-2xl"
    >
      <span className="testo-corpo font-semibold">{message}</span>
      <Button
        variant="onDark"
        size="sm"
        onClick={onUndo}
        disabled={undoing}
        className="border-white/30 bg-white/15 font-bold hover:bg-white/25"
      >
        {undoing ? 'Annullo…' : 'Annulla'}
      </Button>
    </div>
  );
}
