'use client';

// Livello 2 della scala delle conferme: il comando che si scorre.
//
// La scala è: un tocco con cinque secondi per annullare (`UndoToast`) quando l'azione si disfa da
// dentro l'applicazione; il dito tenuto fermo (`HoldButton`) quando toglie una riga da un elenco
// e chi scorreva non se ne accorge; questo quando l'azione ESCE DALL'OFFICINA — segnare un cliente
// assente genera un lead per il BDC e un evento verso il CRM, concludere il check-in manda il
// fascicolo e chiude la pratica. Sono cose che il cliente vede, e che non si disfano da qui.
//
// IL GESTO È IL TRASCINAMENTO, NON IL TOCCO. Il dito parla con la pista tramite gli eventi
// puntatore: il cursore avanza di quanto il dito SI SPOSTA da dove ha toccato, non di dove ha
// toccato. Un tocco secco è uno spostamento zero, e vale zero. `setPointerCapture` tiene il dito
// anche se scivola fuori dalla pista, `touch-action: none` impedisce a Safari di leggere lo
// scorrimento come un pan della pagina.
//
// DURANTE IL TRASCINAMENTO REACT NON C'È. Sull'iPad, con uno swipe veloce, il pollice restava
// indietro rispetto al dito: ogni `pointermove` passava da `setState`, cioè da un ciclo di render, e
// muoveva `width` e `left`, cioè costringeva Safari a rifare il layout a ogni frame. Adesso il
// movimento scrive direttamente sui nodi — `ref` al pollice e al riempimento — e scrive SOLO
// `transform: translate3d(...)`, che il compositore applica sulla GPU senza toccare il layout;
// `will-change: transform` gli chiede di tenere quei due nodi su un livello proprio. React torna
// in gioco al rilascio: è lì che si decide se il gesto vale, e lì lo stato (e il `range` sotto)
// riceve il valore finale. Il ritorno a riposo è una transizione CSS impostata sui nodi prima di
// riportarli a zero: fluido, e senza render.
//
// Dentro resta un `input[type=range]` vero, trasparente e senza eventi puntatore. Non è un dettaglio
// d'implementazione: è quello che rende il comando raggiungibile con le FRECCE della tastiera e
// leggibile da uno screen reader (ruolo slider, valore corrente), senza riscrivere a mano né l'uno
// né l'altro. Nessuna azione dell'applicazione è raggiungibile solo con un gesto.
//
// Il dito e la tastiera si lasciano in modo diverso, ed è voluto: alzare il dito a metà strada
// riporta il cursore all'inizio, perché un trascinamento interrotto è un ripensamento; una freccia
// premuta una volta lo lascia dov'è, perché con la tastiera il gesto si compone un colpo alla
// volta e azzerare a ogni tasto lo renderebbe irraggiungibile.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { cn } from '@/lib/utils/cn';

/** Sopra questa percentuale il gesto vale: gli ultimi pixel non si pretendono col dito. */
export const SOGLIA = 96;
/** Quanto avanza ogni freccia: cinque colpi per arrivare in fondo. */
export const PASSO = 20;
/** Quanto dura il ritorno a riposo, o la corsa finale dopo la soglia. */
export const RITORNO_MS = 200;
/**
 * Sotto questa larghezza non c'è un gesto da fare: il cursore diventa una fessura e chi ha premuto
 * «Assente» si trova davanti un pulsante «Annulla» e nient'altro. È successo davvero, in una
 * finestra stretta: il cursore era `flex-1` accanto a un pulsante di larghezza fissa e cedeva tutto
 * lui, fino a zero pixel. Sotto questa soglia il pulsante accanto va a capo, e il cursore resta.
 */
const LARGHEZZA_MINIMA = '16rem';
/** Il pollice sta dentro `inset-1`: quattro pixel per lato che non fanno parte della corsa. */
const MARGINE_POLLICE_PX = 8;
/** L'etichetta è sparita a questa frazione di corsa: chi è arrivato fin lì sa cosa sta facendo. */
const CORSA_ETICHETTA = 0.6;

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

/**
 * Quanto vale il cursore dopo uno spostamento del dito di `spostamentoPx` su una corsa utile di
 * `corsaPx` (la pista meno il pollice). È la regola che rende innocuo il tocco secco: zero
 * spostamento, zero valore, qualunque sia il punto toccato. Oltre la corsa vale cento, indietro
 * vale zero; una corsa nulla o negativa (pista collassata) non produce mai un valore.
 */
export function valoreDaTrascinamento(spostamentoPx: number, corsaPx: number): number {
  if (!(corsaPx > 0) || !Number.isFinite(spostamentoPx)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round((spostamentoPx / corsaPx) * 100)));
}

/**
 * Le due trasformazioni, in pixel, per una posizione del pollice `px` lungo la corsa. Solo
 * `translate3d`: niente `width`, niente `left`, niente layout.
 *
 * Il riempimento è largo quanto la pista e a riposo sta tutto a sinistra, fuori vista, nascosto
 * dall'`overflow-hidden`. Avanza di quanto avanza il pollice, così la sua estremità destra — che è
 * arrotondata come la pista — resta sempre appena dietro il pollice: a zero non si vede, in fondo
 * arriva dove il pollice comincia. Il colore cresce senza che nessun elemento cambi misura.
 */
export function trasformazioni(
  px: number,
  corsaPx: number,
  larghezzaPistaPx: number,
): { readonly pollice: string; readonly riempimento: string } {
  const p = Math.min(Math.max(px, 0), Math.max(corsaPx, 0));
  return {
    pollice: `translate3d(${p}px, 0, 0)`,
    riempimento: `translate3d(${p - larghezzaPistaPx}px, 0, 0)`,
  };
}

/** Il ritorno a riposo dura `RITORNO_MS`, oppure zero per chi ha chiesto meno movimento. */
function durataRitorno(): string {
  const ridotto =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return `${ridotto ? 0 : RITORNO_MS}ms ease-out`;
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

/** Il dito che sta trascinando: da dove è partito e fin dove è arrivato. */
interface Trascinamento {
  readonly pointerId: number;
  readonly partenzaX: number;
  ultimoPx: number;
}

/** Misure della pista, prese una volta e riprese quando cambia dimensione. */
interface Misure {
  readonly pista: number;
  readonly corsa: number;
}

/** A riposo, senza sapere quanto è larga la pista: il riempimento è tutto a sinistra. */
const RIPOSO_RIEMPIMENTO = { transform: 'translate3d(-100%, 0, 0)' } as const;
const RIPOSO_POLLICE = { transform: 'translate3d(0, 0, 0)' } as const;

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
  /** Il valore che React conosce: cambia con la tastiera e al rilascio del dito, mai durante. */
  const [valore, setValore] = useState(0);
  /** Solo per il cursore del mouse: `grab` / `grabbing`. */
  const [trascinando, setTrascinando] = useState(false);
  /** Una volta partita l'azione il cursore resta in fondo: non rimbalza mentre il server risponde. */
  const partita = useRef(false);
  const pista = useRef<HTMLDivElement | null>(null);
  const pollice = useRef<HTMLSpanElement | null>(null);
  const riempimento = useRef<HTMLSpanElement | null>(null);
  const etichetta = useRef<HTMLSpanElement | null>(null);
  const misure = useRef<Misure>({ pista: 0, corsa: 0 });
  const dito = useRef<Trascinamento | null>(null);
  const colori = TONO[tone];
  const spento = disabled || pending;

  const misura = useCallback((): void => {
    const larghezzaPista = pista.current?.getBoundingClientRect().width ?? 0;
    const larghezzaPollice = pollice.current?.getBoundingClientRect().width ?? 0;
    misure.current = {
      pista: larghezzaPista,
      corsa: Math.max(0, larghezzaPista - larghezzaPollice - MARGINE_POLLICE_PX),
    };
  }, []);

  /**
   * Scrive la posizione sui nodi, senza passare da React. `transizione` vuota = nessuna, il dito
   * comanda; altrimenti il movimento è animato (ritorno a riposo, corsa finale).
   */
  const posiziona = useCallback(
    (px: number, transizione: string): void => {
      const { corsa, pista: larghezzaPista } = misure.current;
      const t = trasformazioni(px, corsa, larghezzaPista);
      const p = pollice.current;
      const r = riempimento.current;
      const e = etichetta.current;
      if (p !== null) {
        p.style.transition = transizione === '' ? 'none' : `transform ${transizione}`;
        p.style.transform = t.pollice;
      }
      if (r !== null) {
        r.style.transition = transizione === '' ? 'none' : `transform ${transizione}`;
        r.style.transform = t.riempimento;
      }
      if (e !== null) {
        // L'etichetta sbiadisce lungo la corsa: `opacity` la compone la GPU come il transform.
        const frazione = corsa > 0 ? Math.min(1, Math.max(0, px / corsa)) : 0;
        e.style.transition = transizione === '' ? 'none' : `opacity ${transizione}`;
        e.style.opacity = String(pending ? 1 : Math.max(0, 1 - frazione / CORSA_ETICHETTA));
      }
    },
    [pending],
  );

  // Le misure seguono la pista: al primo disegno e ogni volta che cambia larghezza (rotazione
  // del tablet, pannello che si stringe). Senza, dopo una rotazione la corsa sarebbe quella vecchia.
  useEffect(() => {
    misura();
    const nodo = pista.current;
    if (nodo === null || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const osservatore = new ResizeObserver(() => {
      misura();
      if (dito.current === null) {
        posiziona((valore / 100) * misure.current.corsa, '');
      }
    });
    osservatore.observe(nodo);
    return () => osservatore.disconnect();
  }, [misura, posiziona, valore]);

  // Quando è React a cambiare il valore — frecce della tastiera, rilascio, conferma — i nodi lo
  // seguono con l'animazione. Mai mentre il dito è sulla pista: lì comanda lui.
  useLayoutEffect(() => {
    if (dito.current !== null) {
      return;
    }
    posiziona((valore / 100) * misure.current.corsa, durataRitorno());
  }, [valore, posiziona]);

  const conferma = useCallback((): void => {
    if (partita.current) {
      return;
    }
    partita.current = true;
    // In fondo con l'animazione, subito: il dito potrebbe essersi fermato al 97%.
    posiziona(misure.current.corsa, durataRitorno());
    setValore(100);
    onConfirm();
  }, [onConfirm, posiziona]);

  /** Il rilascio, da tastiera o per uscita dal campo: qui il valore è quello dello stato. */
  const applica = (come: Rilascio): void => {
    const esito = esitoRilascio(valore, come);
    if (esito === 'conferma') {
      conferma();
    } else if (esito === 'azzera' && !partita.current) {
      setValore(0);
    }
  };

  /** Il dito tocca la pista: da qui in avanti conta solo di quanto si sposta. */
  const toccata = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (spento || partita.current || dito.current !== null) {
      return;
    }
    // Niente selezione del testo, niente eventi mouse di compatibilità, niente callout di iOS.
    event.preventDefault();
    misura();
    dito.current = { pointerId: event.pointerId, partenzaX: event.clientX, ultimoPx: 0 };
    // La cattura tiene il dito anche quando scivola fuori dalla pista: il cursore non si blocca a
    // metà perché il pollice è uscito di un centimetro, e il rilascio arriva sempre a noi. Un
    // puntatore non attivo (eventi sintetici, nei test) farebbe lanciare la cattura: senza cattura
    // il gesto funziona comunque, solo non segue il dito fuori dalla pista.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // nessuna cattura: vedi sopra
    }
    setTrascinando(true);
    posiziona(0, '');
  };

  /** Il dito si muove: solo DOM, nessun render. È il frame che sull'iPad deve stare a 60/120. */
  const trascinata = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const d = dito.current;
    if (d === null || event.pointerId !== d.pointerId) {
      return;
    }
    const px = Math.min(misure.current.corsa, Math.max(0, event.clientX - d.partenzaX));
    d.ultimoPx = px;
    posiziona(px, '');
  };

  /** Il dito si alza: è l'unico momento in cui si decide, e in cui React torna in gioco. */
  const lasciata = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const d = dito.current;
    if (d === null || event.pointerId !== d.pointerId) {
      return;
    }
    dito.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setTrascinando(false);
    // La posizione finale si calcola dall'evento, non si legge da nessuno stato: fra l'ultimo
    // `move` e l'`up` non c'è stato nessun render, e non doveva esserci.
    const spostamento = event.clientX - d.partenzaX;
    const esito = esitoRilascio(valoreDaTrascinamento(spostamento, misure.current.corsa), 'dito');
    if (esito === 'conferma') {
      conferma();
      return;
    }
    // Ripensamento: si torna a riposo con la transizione, e il `range` riceve lo zero.
    posiziona(0, durataRitorno());
    setValore(0);
  };

  return (
    <div
      ref={pista}
      data-testid={testId === undefined ? undefined : `${testId}-pista`}
      className={cn(
        'border-line bg-surface relative isolate overflow-hidden rounded-full border select-none',
        'controllo-lg touch-none',
        trascinando ? 'cursor-grabbing' : 'cursor-grab',
        colori.bordo,
        spento && 'pointer-events-none opacity-60',
        className,
      )}
      style={{ minWidth: LARGHEZZA_MINIMA }}
      onPointerDown={toccata}
      onPointerMove={trascinata}
      onPointerUp={lasciata}
      onPointerCancel={lasciata}
    >
      {/*
       * Il riempimento: largo quanto la pista, a riposo tutto a sinistra fuori vista. React gli
       * dà solo la posizione di riposo; da lì in avanti lo muove `posiziona`, col transform.
       */}
      <span
        ref={riempimento}
        aria-hidden="true"
        className={cn(
          'absolute inset-y-0 left-0 w-full rounded-full will-change-transform',
          colori.riempimento,
        )}
        style={RIPOSO_RIEMPIMENTO}
      />
      {/*
       * L'etichetta sbiadisce mentre il riempimento avanza, invece di restare ferma sotto. Tenerla
       * significava vederla tagliata a metà dal bordo del colore e dal pollice, con una parte di
       * testo scuro su fondo pieno e l'altra no: illeggibile proprio nel momento in cui si guarda
       * il comando. A due terzi di corsa non serve più — chi è arrivato fin lì sa cosa sta facendo.
       */}
      <span
        ref={etichetta}
        aria-hidden="true"
        className={cn(
          // Spazio a sinistra solo per il pollice; a destra basta un margine. Con `px-14` su un
          // cursore stretto restavano cento pixel di testo e l'etichetta andava a capo tre volte,
          // sbordando da una pista alta una riga sola. `truncate`: una riga, sempre.
          'testo-corpo pointer-events-none absolute inset-0 flex items-center justify-center truncate pr-5 pl-16 text-center font-semibold will-change-[opacity]',
          colori.testo,
        )}
      >
        {pending ? pendingLabel : label}
      </span>
      {/* Il pollice: dice dove mettere il dito, e dove sta andando. Si muove solo col transform. */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-1">
        <span
          ref={pollice}
          className="bg-surface text-ink-soft absolute top-0 bottom-0 left-0 flex aspect-square items-center justify-center rounded-full text-xl leading-none font-bold shadow-sm will-change-transform"
          style={RIPOSO_POLLICE}
        >
          ›
        </span>
      </span>
      {/*
       * Solo tastiera e screen reader: `pointer-events-none` lascia passare il dito alla pista.
       * Il valore lo cambiano le frecce (`onChange`), il rilascio del tasto decide (`onKeyUp`), e al
       * rilascio del dito riceve il valore finale (0 o 100) da React.
       */}
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
        className="focus-anello pointer-events-none absolute inset-0 h-full w-full opacity-0"
        onChange={(event) => setValore(Number(event.target.value))}
        onKeyUp={() => applica('tastiera')}
        onBlur={() => applica('uscita')}
      />
    </div>
  );
}
