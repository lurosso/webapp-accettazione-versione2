'use client';

// Comando che chiede più di un tocco, perché quello che fa non si disfa da solo.
//
// La regola non è «chiedi conferma a tutto»: alla trentesima volta in una mattinata una finestra
// di conferma non la legge più nessuno e si clicca «Sì» per riflesso. Qui si paga solo dove serve,
// e la difesa cambia con quello che si ha in mano, perché cambia il rischio:
//
// - sul TABLET il pericolo è lo sfioramento: il dito appoggia mentre si scorre l'elenco. Serve un
//   gesto che non capita per caso, quindi il dito tenuto fermo per 900 ms, con il pulsante che si
//   riempie sotto le dita — così si vede che sta succedendo qualcosa e si può ancora ritirarsi;
// - al BANCO il pericolo è il clic distratto, non lo sfioramento. Tenere premuto un mouse per
//   quasi un secondo sarebbe solo un'attesa senza senso: lì il comando chiede un secondo clic, e
//   nel frattempo dice cosa sta per fare.
//
// Chi arriva da tastiera non può «tenere premuto» in nessuno dei due casi: `Invio` e `Spazio`
// producono un click senza eventi di puntatore, e quel percorso prende sempre la conferma in due
// passi. Nessuna azione è raggiungibile SOLO con un gesto.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, type ButtonSize, type ButtonVariant } from '@/components/ui/button';
import { useIsTouchLayout } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/utils/cn';

/** Quanto va tenuto il dito. Sotto i 700 ms si confonde con un tocco lungo involontario. */
const DURATA_PRESSIONE_MS = 900;
/** Dopo quanto la richiesta di conferma decade da sola, per non restare appesa sulla riga. */
const SCADENZA_CONFERMA_MS = 6_000;
/** Quanto resta il suggerimento dopo un tocco breve. */
const DURATA_SUGGERIMENTO_MS = 2_000;

type Stato = 'riposo' | 'premuto' | 'conferma' | 'suggerimento';

export interface HoldButtonProps {
  /** Eseguita solo quando il gesto è stato completato davvero. */
  readonly onConfirm: () => void;
  /** Etichetta a riposo. */
  readonly children: ReactNode;
  /** Cosa si sta per fare, mostrato mentre chiede conferma: «Confermi assente?». */
  readonly confirmLabel: string;
  /** Nome per esteso dell'azione, per chi ascolta la pagina. */
  readonly actionLabel: string;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly disabled?: boolean;
  readonly className?: string | undefined;
}

export function HoldButton({
  onConfirm,
  children,
  confirmLabel,
  actionLabel,
  variant = 'outline',
  size = 'md',
  disabled = false,
  className,
}: HoldButtonProps) {
  const tocco = useIsTouchLayout();
  const [stato, setStato] = useState<Stato>('riposo');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** True fra `pointerdown` e il click che ne consegue: distingue il dito dalla tastiera. */
  const daPuntatore = useRef(false);

  const fermaTimer = useCallback((): void => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => fermaTimer, [fermaTimer]);

  // Se il puntatore cambia natura a metà gesto (una tastiera collegata al tablet), il
  // riempimento non deve restare appeso: lo stato si ricava, non si corregge con un effetto.
  const statoVisibile: Stato = !tocco && stato === 'premuto' ? 'riposo' : stato;

  const conferma = useCallback((): void => {
    fermaTimer();
    setStato('riposo');
    onConfirm();
  }, [fermaTimer, onConfirm]);

  const iniziaPressione = (): void => {
    daPuntatore.current = true;
    if (!tocco || disabled || stato === 'conferma') {
      return;
    }
    fermaTimer();
    setStato('premuto');
    timer.current = setTimeout(conferma, DURATA_PRESSIONE_MS);
  };

  const interrompiPressione = (): void => {
    if (stato !== 'premuto') {
      return;
    }
    fermaTimer();
    // Il dito si è alzato troppo presto: invece di non fare niente, si spiega cosa serve.
    setStato('suggerimento');
    timer.current = setTimeout(() => setStato('riposo'), DURATA_SUGGERIMENTO_MS);
  };

  const onClick = (): void => {
    const conIlDito = daPuntatore.current;
    daPuntatore.current = false;
    // Sul tablet il percorso col dito è quello della pressione: il click che segue non deve
    // confermare niente, altrimenti due tocchi rapidi varrebbero come un gesto deliberato.
    if (tocco && conIlDito) {
      return;
    }
    if (stato === 'conferma') {
      conferma();
      return;
    }
    fermaTimer();
    setStato('conferma');
    timer.current = setTimeout(() => setStato('riposo'), SCADENZA_CONFERMA_MS);
  };

  const etichetta =
    statoVisibile === 'conferma'
      ? confirmLabel
      : statoVisibile === 'suggerimento'
        ? 'Tieni premuto'
        : children;

  return (
    <Button
      variant={statoVisibile === 'conferma' ? 'destructive' : variant}
      size={size}
      disabled={disabled}
      aria-label={statoVisibile === 'conferma' ? `Conferma: ${actionLabel}` : actionLabel}
      className={cn('relative overflow-hidden select-none', className)}
      onPointerDown={iniziaPressione}
      onPointerUp={interrompiPressione}
      onPointerLeave={interrompiPressione}
      onPointerCancel={interrompiPressione}
      onClick={onClick}
      style={tocco ? { touchAction: 'none' } : undefined}
    >
      {/*
       * Il riempimento non è una barra di avanzamento: è il pulsante stesso che si colora da
       * sinistra. Senza, novecento millisecondi col dito fermo sembrano un pulsante rotto.
       */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 bg-white/30"
        style={
          statoVisibile === 'premuto'
            ? { width: '100%', transition: `width ${DURATA_PRESSIONE_MS}ms linear` }
            : { width: '0%', transition: 'width 160ms var(--ease-smooth)' }
        }
      />
      <span className="relative">{etichetta}</span>
    </Button>
  );
}
