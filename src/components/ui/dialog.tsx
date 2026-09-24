'use client';

// Finestra modale minima e accessibile (role="dialog", aria-modal, chiusura con Esc e clic sullo
// sfondo). Sostituisce Radix Dialog finché shadcn/ui non viene inizializzato (M0-T07-S02 rinviato).
//
// All'apertura il fuoco entra nella finestra e alla chiusura torna dov'era: senza questo, chi usa
// la tastiera o un lettore di schermo resta indietro nella pagina mentre la modale è davanti a
// tutto. Lo scorrimento della pagina sotto resta bloccato, che su tablet evita il fastidio di
// trascinare la finestra e vedersi muovere la coda dietro.
import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

export interface DialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly description?: string | undefined;
  readonly onClose: () => void;
  readonly children?: ReactNode;
  readonly footer?: ReactNode;
  readonly className?: string | undefined;
}

export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  className,
}: DialogProps) {
  const finestra = useRef<HTMLDivElement>(null);

  // `onClose` vive in un ref: chi usa la finestra passa quasi sempre una freccia inline, che cambia
  // identità a ogni render. Se fosse una dipendenza dell'effetto qui sotto, ogni tasto premuto in un
  // campo del modulo (setState → render → nuova onClose) rieseguirebbe l'effetto e rimetterebbe il
  // fuoco sul contenitore: l'input lo perdeva a ogni carattere. È successo nella gestione utenti.
  const chiudi = useRef(onClose);
  useEffect(() => {
    chiudi.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        chiudi.current();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    // Il fuoco entra nella finestra UNA volta, all'apertura — e solo se non è già dentro: un
    // campo già attivo non si tocca.
    const precedente = document.activeElement;
    const nodo = finestra.current;
    if (nodo !== null && !nodo.contains(document.activeElement)) {
      nodo.focus();
    }
    const scorrimento = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = scorrimento;
      if (precedente instanceof HTMLElement) {
        precedente.focus();
      }
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="animate-velo bg-ink/45 fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        ref={finestra}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        tabIndex={-1}
        className={cn(
          // Mai più alta dello schermo: su un iPad in orizzontale, con la tastiera aperta, il piede
          // con i comandi (Salva, Annulla) resta raggiungibile scorrendo dentro la finestra.
          'animate-finestra bg-surface focus-anello max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl p-6 shadow-2xl sm:p-7',
          className,
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="dialog-title" className="text-ink text-xl font-semibold tracking-tight">
          {title}
        </h2>
        {description !== undefined ? (
          <p className="text-ink-soft testo-corpo mt-1.5">{description}</p>
        ) : null}
        {children !== undefined ? <div className="mt-6">{children}</div> : null}
        {footer !== undefined ? (
          <div className="mt-7 flex flex-wrap justify-end gap-3">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
