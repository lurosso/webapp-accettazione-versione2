'use client';

// Livello 2 della scala delle conferme: il comando che si scorre.
//
// La scala è: un tocco con cinque secondi per annullare (`UndoToast`) quando l'azione si disfa da
// dentro l'applicazione; il dito tenuto fermo (`HoldButton`) quando toglie una riga da un elenco
// e chi scorreva non se ne accorge; questo quando l'azione ESCE DALL'OFFICINA — segnare un cliente
// assente genera un lead per il BDC e un evento verso il CRM, concludere il check-in manda il
// fascicolo e chiude la pratica. Sono cose che il cliente vede, e che non si disfano da qui.
//
// Perché uno scorrimento e non una pressione più lunga: tenere premuto più a lungo non è un gesto
// diverso, è lo stesso gesto più noioso — e un dito appoggiato per sbaglio ci arriva comunque, se
// il tablet resta in mano. Uno scorrimento è un movimento che la manica non fa.
//
// Dentro c'è un `input[type=range]` vero, trasparente sopra il disegno. Non è un dettaglio
// d'implementazione: è quello che rende il comando raggiungibile con le FRECCE della tastiera e
// leggibile da uno screen reader (ruolo slider, valore corrente), senza riscrivere a mano né
// l'uno né l'altro. Nessuna azione dell'applicazione è raggiungibile solo con un gesto.
//
// Il dito e la tastiera si lasciano in modo diverso, ed è voluto: alzare il dito a metà strada
// riporta il cursore all'inizio, perché un trascinamento interrotto è un ripensamento; una freccia
// premuta una volta lo lascia dov'è, perché con la tastiera il gesto si compone un colpo alla
// volta e azzerare a ogni tasto lo renderebbe irraggiungibile.
import { useCallback, useRef, useState } from 'react';
import { cn } from '@/lib/utils/cn';

/** Sopra questa percentuale il gesto vale: gli ultimi pixel non si pretendono col dito. */
export const SOGLIA = 96;
/** Quanto avanza ogni freccia: cinque colpi per arrivare in fondo. */
export const PASSO = 20;
/**
 * Sotto questa larghezza non c'è un gesto da fare: il cursore diventa una fessura e chi ha premuto
 * «Assente» si trova davanti un pulsante «Annulla» e nient'altro. È successo davvero, in una
 * finestra stretta: il cursore era `flex-1` accanto a un pulsante di larghezza fissa e cedeva tutto
 * lui, fino a zero pixel. Sotto questa soglia il pulsante accanto va a capo, e il cursore resta.
 */
const LARGHEZZA_MINIMA = '16rem';

/** Come si è concluso il gesto. La tastiera non è il dito, e finiscono in modo diverso. */
export type Rilascio = 'dito' | 'tastiera' | 'uscita';
export type EsitoRilascio = 'conferma' | 'azzera' | 'resta';

/**
 * La regola del rilascio, in chiaro e fuori dai gestori: è la parte che decide se un cliente esce
 * dall'officina, e va potuta leggere e provare senza montare un browser.
 *
 * Il dito che si alza a metà strada è un ripensamento: si torna a zero. Una freccia premuta una
 * volta no: con la tastiera il gesto si compone un colpo alla volta, e azzerare a ogni tasto
 * renderebbe il comando irraggiungibile. Uscire dal campo azzera come il dito.
 */
export function esitoRilascio(valore: number, come: Rilascio): EsitoRilascio {
  if (valore >= SOGLIA) {
    return 'conferma';
  }
  return come === 'tastiera' ? 'resta' : 'azzera';
}

export type SlideTone = 'destructive' | 'success';

export interface SlideToConfirmProps {
  /** Eseguita quando lo scorrimento arriva in fondo. */
  readonly onConfirm: () => void;
  /** «Scorri per segnare assente» — dice il gesto e la conseguenza. */
  readonly label: string;
  /** Mostrata mentre il server risponde. */
  readonly pendingLabel?: string;
  /** Nome per esteso dell'azione, per chi ascolta la pagina. */
  readonly actionLabel: string;
  readonly tone?: SlideTone;
  readonly pending?: boolean;
  readonly disabled?: boolean;
  readonly className?: string | undefined;
  readonly 'data-testid'?: string | undefined;
}

const TONO: Record<SlideTone, { riempimento: string; bordo: string; testo: string }> = {
  destructive: {
    riempimento: 'bg-status-no-show-solid',
    bordo: 'border-status-no-show/40',
    testo: 'text-status-no-show-ink',
  },
  success: {
    riempimento: 'bg-brand-primary',
    bordo: 'border-brand-primary/60',
    testo: 'text-brand-lime-ink',
  },
};

export function SlideToConfirm({
  onConfirm,
  label,
  pendingLabel = 'Un istante…',
  actionLabel,
  tone = 'destructive',
  pending = false,
  disabled = false,
  className,
  'data-testid': testId,
}: SlideToConfirmProps) {
  const [valore, setValore] = useState(0);
  /** Mentre il dito trascina il riempimento segue senza transizione, o resta indietro. */
  const [trascinando, setTrascinando] = useState(false);
  /** Una volta partita l'azione il cursore resta in fondo: non rimbalza mentre il server risponde. */
  const partita = useRef(false);
  const colori = TONO[tone];
  const spento = disabled || pending;

  const conferma = useCallback((): void => {
    if (partita.current) {
      return;
    }
    partita.current = true;
    setValore(100);
    onConfirm();
  }, [onConfirm]);

  const applica = (come: Rilascio): void => {
    if (come === 'dito') {
      setTrascinando(false);
    }
    const esito = esitoRilascio(valore, come);
    if (esito === 'conferma') {
      conferma();
    } else if (esito === 'azzera' && !partita.current) {
      setValore(0);
    }
  };

  const animazione = trascinando ? 'none' : '240ms var(--ease-smooth)';

  return (
    <div
      className={cn(
        'border-line bg-surface relative isolate overflow-hidden rounded-full border select-none',
        'controllo-lg',
        colori.bordo,
        spento && 'pointer-events-none opacity-60',
        className,
      )}
      style={{ minWidth: LARGHEZZA_MINIMA }}
    >
      {/* Il riempimento è il disegno; l'input vero è trasparente e sta sopra. */}
      <span
        aria-hidden="true"
        className={cn('absolute inset-y-0 left-0 rounded-full', colori.riempimento)}
        style={{ width: `${valore}%`, transition: `width ${animazione}` }}
      />
      {/*
       * L'etichetta sbiadisce mentre il riempimento avanza, invece di restare ferma sotto. Tenerla
       * significava vederla tagliata a metà dal bordo del colore e dal pollice, con una parte di
       * testo scuro su fondo pieno e l'altra no: illeggibile proprio nel momento in cui si guarda
       * il comando. A due terzi di corsa non serve più — chi è arrivato fin lì sa cosa sta facendo.
       */}
      <span
        aria-hidden="true"
        className={cn(
          // Spazio a sinistra solo per il pollice; a destra basta un margine. Con `px-14` su un
          // cursore stretto restavano cento pixel di testo e l'etichetta andava a capo tre volte,
          // sbordando da una pista alta una riga sola. `truncate`: una riga, sempre.
          'testo-corpo pointer-events-none absolute inset-0 flex items-center justify-center truncate pr-5 pl-16 text-center font-semibold',
          colori.testo,
        )}
        style={{
          opacity: pending ? 1 : Math.max(0, 1 - valore / 60),
          transition: `opacity ${animazione}`,
        }}
      >
        {pending ? pendingLabel : label}
      </span>
      {/* Il pollice: dice dove mettere il dito, e dove sta andando. */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-1">
        <span
          className="bg-surface text-ink-soft absolute top-0 bottom-0 flex aspect-square items-center justify-center rounded-full text-xl leading-none font-bold shadow-sm"
          style={{
            left: `${valore}%`,
            transform: `translateX(-${valore}%)`,
            transition: `left ${animazione}, transform ${animazione}`,
          }}
        >
          ›
        </span>
      </span>
      <input
        type="range"
        min={0}
        max={100}
        step={PASSO}
        value={valore}
        disabled={spento}
        data-testid={testId}
        aria-label={actionLabel}
        aria-valuetext={valore >= SOGLIA ? 'in fondo: rilascia per confermare' : `${valore}%`}
        className="focus-anello absolute inset-0 h-full w-full cursor-grab opacity-0"
        onPointerDown={() => setTrascinando(true)}
        onChange={(event) => setValore(Number(event.target.value))}
        onPointerUp={() => applica('dito')}
        onPointerCancel={() => applica('dito')}
        onKeyUp={() => applica('tastiera')}
        onBlur={() => applica('uscita')}
      />
    </div>
  );
}
