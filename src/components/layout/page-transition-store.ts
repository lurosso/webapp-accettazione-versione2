// Stato della transizione di pagina, condiviso fra chi avvia una navigazione e il contenitore che
// la disegna. Un piccolo store esterno (per `useSyncExternalStore`), senza dipendenze da React.
//
// Perché esiste: il contenitore animato è legato al percorso e si rimonta a ogni navigazione, quindi
// non può sapere da solo che si sta per andare via. Chi tocca un link o chiama `push` lo dice qui
// («sto lasciando /accettazione»), e il contenitore di QUELLA pagina sfuma subito — feedback al
// tocco — mentre la nuova viene richiesta al server. Il contenitore della pagina nuova legge lo
// store, vede che non riguarda lui, e fa la sua entrata.

let percorsoInUscita: string | null = null;
let timerSicurezza: ReturnType<typeof setTimeout> | null = null;
const ascoltatori = new Set<() => void>();

/** Se la navigazione non arriva (stessa pagina, errore di rete), la pagina non resta sfumata. */
export const USCITA_MASSIMA_MS = 2_500;

function avvisa(): void {
  for (const cb of ascoltatori) {
    cb();
  }
}

/** La pagina `pathname` sta per essere lasciata: il suo contenitore sfuma. */
export function segnalaUscita(pathname: string): void {
  percorsoInUscita = pathname;
  if (timerSicurezza !== null) {
    clearTimeout(timerSicurezza);
  }
  timerSicurezza = setTimeout(azzeraUscita, USCITA_MASSIMA_MS);
  avvisa();
}

/** La pagina nuova è montata (o la navigazione non è arrivata): nessuna uscita in corso. */
export function azzeraUscita(): void {
  if (timerSicurezza !== null) {
    clearTimeout(timerSicurezza);
    timerSicurezza = null;
  }
  if (percorsoInUscita === null) {
    return;
  }
  percorsoInUscita = null;
  avvisa();
}

export function percorsoInUscitaCorrente(): string | null {
  return percorsoInUscita;
}

/** Sul server non c'è mai un'uscita in corso. */
export function percorsoInUscitaServer(): null {
  return null;
}

export function iscrivitiAllaTransizione(cb: () => void): () => void {
  ascoltatori.add(cb);
  return () => {
    ascoltatori.delete(cb);
  };
}

/**
 * Prima visita della sessione: la pagina iniziale si mostra SUBITO, com'è arrivata dal server —
 * nessuna pagina bianca in attesa che il JavaScript si carichi e faccia partire la dissolvenza.
 * L'entrata animata vale dalla seconda pagina in poi, cioè per le navigazioni fatte a mano.
 */
let primaPaginaMontata = false;

export function primaPaginaGiaMontata(): boolean {
  return primaPaginaMontata;
}

export function segnaPrimaPaginaMontata(): void {
  primaPaginaMontata = true;
}

/** Solo per i test: riporta lo store allo stato iniziale. */
export function resetTransizionePerTest(): void {
  percorsoInUscita = null;
  primaPaginaMontata = false;
  if (timerSicurezza !== null) {
    clearTimeout(timerSicurezza);
    timerSicurezza = null;
  }
  ascoltatori.clear();
}

/** Il pezzo di percorso prima di `?` e `#`: due link alla stessa pagina non fanno uscire nessuno. */
export function soloPercorso(href: string): string {
  const fine = href.search(/[?#]/);
  return fine === -1 ? href : href.slice(0, fine);
}

export interface ClickDiNavigazione {
  readonly button?: number;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
  readonly defaultPrevented?: boolean;
}

/**
 * True se il click è una navigazione "normale" da animare: tasto principale, senza modificatori
 * (Cmd/Ctrl-click aprono una scheda, Shift una finestra: il browser fa il suo, noi non tocchiamo),
 * non già gestito da qualcun altro, e verso la stessa finestra.
 */
export function clickDaAnimare(event: ClickDiNavigazione, target?: string | null): boolean {
  if (event.defaultPrevented === true) {
    return false;
  }
  if ((event.button ?? 0) !== 0) {
    return false;
  }
  if (
    event.metaKey === true ||
    event.ctrlKey === true ||
    event.shiftKey === true ||
    event.altKey === true
  ) {
    return false;
  }
  return target === undefined || target === null || target === '' || target === '_self';
}
