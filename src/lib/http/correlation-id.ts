// Forma ammessa per il correlation id che arriva dal client.
//
// Viene copiato nei log e rimesso nell'intestazione di risposta: un valore con a-capo farebbe
// lanciare il costruttore di `Headers` (500), uno di decine di KB gonfierebbe log e risposte. Chi
// ne manda uno fuori forma ne riceve uno nuovo, senza errori: non è un input da cui dipende nulla.
export const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

/** Il valore in ingresso se ha la forma giusta, altrimenti `null`. */
export function acceptedCorrelationId(raw: string | null | undefined): string | null {
  return raw !== null && raw !== undefined && CORRELATION_ID_PATTERN.test(raw) ? raw : null;
}
