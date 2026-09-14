// Ripetizione di una chiamata esterna con attesa crescente e un po' di casualità (jitter).
//
// Si riprova solo sugli errori che il provider dichiara ritentabili (rete, timeout, 5xx): un
// "richiesta non valida" ripetuto tre volte resta non valido e fa solo perdere tempo. Il jitter
// serve quando più postazioni riprovano insieme dopo lo stesso guasto: senza, ripartirebbero tutte
// nello stesso istante, e il sistema esterno le vedrebbe arrivare a ondate.
import type { ProviderError, ProviderResult } from '../interfaces/common';

export interface RetryOptions {
  /** Ripetizioni oltre al primo tentativo (2 → al massimo tre chiamate). */
  readonly retries: number;
  /** Attesa prima del primo tentativo ripetuto (ms); raddoppia a ogni ripetizione. */
  readonly baseDelayMs: number;
  /** Tetto dell'attesa (ms). */
  readonly maxDelayMs?: number;
  /** Frazione casuale aggiunta all'attesa, 0..1 (default 0.2 = fino al 20 % in più). */
  readonly jitterRatio?: number;
  /** Sorgente di casualità iniettabile (0..1); nei test si passa una costante. */
  readonly random?: () => number;
  /** Attesa iniettabile (nei test non si dorme davvero). */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Chiamato a ogni ripetizione, per i log. */
  readonly onRetry?: (attempt: number, error: ProviderError, delayMs: number) => void;
  /** Interruzione dal chiamante: se scatta, non si riprova più. */
  readonly signal?: AbortSignal | undefined;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Attesa del tentativo `attempt` (1 = prima ripetizione), con jitter. */
export function retryDelayMs(attempt: number, options: RetryOptions, random: number): number {
  const base = options.baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(base, options.maxDelayMs ?? Number.POSITIVE_INFINITY);
  const jitter = capped * (options.jitterRatio ?? 0.2) * Math.min(1, Math.max(0, random));
  return Math.round(capped + jitter);
}

/**
 * Esegue `call` e, se torna un errore ritentabile, la ripete fino a `retries` volte.
 * Restituisce l'ultimo esito: chi chiama vede un normale `ProviderResult`, come se la chiamata
 * fosse stata una sola.
 */
export async function withRetry<T>(
  call: (attempt: number) => Promise<ProviderResult<T>>,
  options: RetryOptions,
): Promise<ProviderResult<T>> {
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  let esito = await call(0);
  for (let attempt = 1; attempt <= options.retries; attempt += 1) {
    if (esito.ok || !esito.error.retryable || options.signal?.aborted === true) {
      return esito;
    }
    const delayMs = retryDelayMs(attempt, options, random());
    options.onRetry?.(attempt, esito.error, delayMs);
    await sleep(delayMs);
    esito = await call(attempt);
  }
  return esito;
}
