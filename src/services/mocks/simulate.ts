// Utilità condivise dai mock per simulare latenza e rispettare AbortSignal.

/** Indica se il segnale è già stato annullato. */
export function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

/**
 * Attende `ms` millisecondi; si risolve in anticipo (con `false`) se il segnale viene annullato.
 * Restituisce `true` se l'attesa è terminata normalmente.
 */
export function simulateLatency(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (ms <= 0) {
    return Promise.resolve(!isAborted(signal));
  }
  if (isAborted(signal)) {
    return Promise.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Misura la durata in millisecondi fra due istanti `Date`. */
export function elapsedMs(start: Date, end: Date): number {
  return Math.max(0, end.getTime() - start.getTime());
}
