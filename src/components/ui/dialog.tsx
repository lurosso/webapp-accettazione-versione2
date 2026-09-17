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

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    const precedente = document.activeElement;
    finestra.current?.focus();
    const scorrimento = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = scorrimento;
      if (precedente instanceof HTMLElement) {
        precedente.focus();
      }
    };
  }, [open, onClose]);

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
          'animate-finestra bg-surface focus-anello w-full max-w-lg rounded-2xl p-6 shadow-2xl sm:p-7',
          className,
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="dialog-title" className="text-ink text-xl font-semibold tracking-tight">
          {title}
        </h2>
        {description !== undefined ? (
          <p className="text-ink-soft mt-1.5 text-sm">{description}</p>
        ) : null}
        {children !== undefined ? <div className="mt-6">{children}</div> : null}
        {footer !== undefined ? (
          <div className="mt-7 flex flex-wrap justify-end gap-3">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
