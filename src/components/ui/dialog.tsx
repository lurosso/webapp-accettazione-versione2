'use client';

// Finestra modale minima e accessibile (role="dialog", aria-modal, chiusura con Esc e clic sullo sfondo).
// Sostituisce Radix Dialog finché shadcn/ui non viene inizializzato (M0-T07-S02 rinviato).
import { useEffect, type ReactNode } from 'react';
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
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        className={cn('w-full max-w-lg rounded-xl bg-white p-6 shadow-xl', className)}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="dialog-title" className="text-lg font-semibold">
          {title}
        </h2>
        {description !== undefined ? (
          <p className="mt-1 text-sm text-slate-600">{description}</p>
        ) : null}
        {children !== undefined ? <div className="mt-4">{children}</div> : null}
        {footer !== undefined ? (
          <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
