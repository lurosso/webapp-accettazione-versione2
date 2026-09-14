// Tetto alle connessioni SSE aperte, per indirizzo e in totale.
//
// Un flusso SSE tiene occupata una connessione finché il client non chiude. Su un server piccolo
// come quello dell'officina, qualche centinaio di connessioni aperte da un solo indirizzo basta a
// esaurire le risorse: è l'unico vero vettore di abuso del canale pubblico, che altrimenti non
// legge né scrive nulla. Chi supera il tetto riceve 503 e il client, per come è scritto, torna al
// polling: peggiora la reattività, non la correttezza.
//
// I contatori vivono su globalThis, come il limitatore di frequenza: sopravvivono all'HMR di
// sviluppo e sono condivisi da tutte le richieste del processo.

export interface ConnectionLimits {
  /** Connessioni aperte contemporaneamente dallo stesso indirizzo. */
  readonly perClient: number;
  /** Connessioni aperte contemporaneamente in tutto il processo. */
  readonly total: number;
}

interface Registry {
  readonly perClient: Map<string, number>;
  total: number;
}

const GLOBAL_KEY = '__accettazioneSseConnections';

function registry(): Registry {
  const g = globalThis as unknown as Record<string, unknown>;
  const existing = g[GLOBAL_KEY];
  if (typeof existing === 'object' && existing !== null && 'perClient' in existing) {
    return existing as Registry;
  }
  const created: Registry = { perClient: new Map(), total: 0 };
  g[GLOBAL_KEY] = created;
  return created;
}

export type ConnectionTicket =
  | { readonly allowed: true; readonly release: () => void }
  | { readonly allowed: false; readonly reason: 'client' | 'total' };

/**
 * Prova a registrare una nuova connessione per `clientKey` (di norma l'indirizzo IP, con un
 * prefisso che distingue il canale). Se ammessa, restituisce la funzione da chiamare alla
 * chiusura: senza quella, il posto resterebbe occupato per sempre.
 */
export function acquireConnection(clientKey: string, limits: ConnectionLimits): ConnectionTicket {
  const reg = registry();
  const attuali = reg.perClient.get(clientKey) ?? 0;
  if (attuali >= limits.perClient) {
    return { allowed: false, reason: 'client' };
  }
  if (reg.total >= limits.total) {
    return { allowed: false, reason: 'total' };
  }
  reg.perClient.set(clientKey, attuali + 1);
  reg.total += 1;

  let rilasciato = false;
  return {
    allowed: true,
    release: () => {
      // Il rilascio può arrivare due volte (abort e chiusura): conta una sola.
      if (rilasciato) {
        return;
      }
      rilasciato = true;
      const rimaste = (reg.perClient.get(clientKey) ?? 1) - 1;
      if (rimaste <= 0) {
        reg.perClient.delete(clientKey);
      } else {
        reg.perClient.set(clientKey, rimaste);
      }
      reg.total = Math.max(0, reg.total - 1);
    },
  };
}

/** Connessioni aperte adesso (per diagnostica e test). */
export function openConnections(): { readonly total: number; readonly clients: number } {
  const reg = registry();
  return { total: reg.total, clients: reg.perClient.size };
}

/** Azzera i contatori (solo per i test). */
export function resetConnectionsForTests(): void {
  const reg = registry();
  reg.perClient.clear();
  reg.total = 0;
}
