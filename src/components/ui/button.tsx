// Pulsante base (convenzioni shadcn/ui, codice nel repo, nessun lock-in).
//
// Nessuna taglia scende sotto i 44 px. Prima il valore predefinito (`md`) era alto 40 px e `sm`
// 32: due misure sotto la soglia del dito, usate ovunque perché erano il default. Una taglia
// "compatta" ora è compatta in larghezza, non in altezza — l'altezza non è negoziabile su un
// tablet tenuto in mano sul piazzale.
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

export type ButtonVariant =
  | 'default'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'destructive'
  /**
   * Azione distruttiva che compare su OGNI riga di un elenco. Piena sarebbe un muro rosso in cui
   * il rosso non vuol più dire niente — e un bersaglio pieno invita il dito. Diventa piena solo
   * quando chiede la conferma, che è il momento in cui deve fermare chi sta scorrendo.
   */
  | 'destructiveQuiet'
  | 'success'
  | 'warning'
  /** Contorno chiaro per le barre blu e i monitor: sul fondo scuro l'outline normale sparisce. */
  | 'onDark';

/**
 * Le altezze non sono più numeri fissi: le decide la densità (`controllo`, `controllo-lg` in
 * `globals.css`), che cambia da sola secondo il puntatore. `md` è il predefinito — 44 px al banco,
 * 52 col dito. `sm` è la stessa altezza con meno respiro ai lati, per i comandi di contorno che
 * stanno in una riga fitta. `lg` è l'azione primaria di una schermata: 48 al banco, 60 sul
 * piazzale. `touch` resta come alias di `md`, scritto com'è in una trentina di punti.
 */
export type ButtonSize = 'sm' | 'md' | 'lg' | 'touch';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  // Blu Autoclub: struttura, navigazione e azioni di lavoro (prendi in carico, filtri).
  default: 'bg-brand-secondary text-white shadow-xs hover:bg-brand-blue-dark',
  secondary: 'bg-surface-sunken text-ink hover:bg-line',
  outline: 'border-line bg-surface text-ink-soft hover:bg-surface-sunken border',
  ghost: 'text-ink-soft hover:bg-surface-sunken',
  destructive: 'bg-status-no-show-solid hover:bg-status-no-show-solid-hover text-white shadow-xs',
  destructiveQuiet:
    'border-status-no-show/35 bg-surface text-status-no-show-ink hover:bg-status-no-show-soft border',
  // Verde Autoclub: solo completamento e avanzamento. Testo scuro: il verde del marchio con il
  // bianco sopra non si legge (2,6:1). `ink-forte` e' il nero della famiglia dell'inchiostro,
  // misurato 8,1:1 sul verde e 9,6:1 sull'ambra qui sotto. Prima erano `slate-950` e `slate-900`.
  success: 'bg-brand-primary text-ink-forte shadow-xs hover:bg-brand-lime-dark hover:text-white',
  warning: 'bg-status-in-progress text-ink-forte hover:brightness-95',
  // Sul fondo blu l'anello di focus blu sparisce: qui diventa bianco.
  onDark: 'border border-white/40 bg-white/10 text-white hover:bg-white/20 [--anello-colore:#fff]',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'controllo min-w-touch testo-nota px-3.5',
  md: 'controllo min-w-touch testo-corpo px-5',
  touch: 'controllo min-w-touch testo-corpo px-5',
  lg: 'controllo-lg min-w-touch testo-dato px-7',
};

export function Button({
  className,
  variant = 'default',
  size = 'md',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'premibile focus-anello inline-flex items-center justify-center gap-2 rounded-md font-semibold whitespace-nowrap',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    />
  );
}
