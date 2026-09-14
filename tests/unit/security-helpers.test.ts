import { beforeEach, describe, expect, it } from 'vitest';
import { secretsMatch } from '@/lib/http/secrets';
import {
  acquireConnection,
  openConnections,
  resetConnectionsForTests,
} from '@/lib/realtime/connection-guard';

describe('secretsMatch: confronto di segreti a tempo costante', () => {
  it('riconosce il segreto giusto e rifiuta quelli sbagliati', () => {
    expect(secretsMatch('abc-123', 'abc-123')).toBe(true);
    expect(secretsMatch('abc-124', 'abc-123')).toBe(false);
    expect(secretsMatch('abc', 'abc-123')).toBe(false);
    expect(secretsMatch('abc-123-lungo', 'abc-123')).toBe(false);
  });

  it('senza segreto configurato non passa nulla, nemmeno la stringa vuota', () => {
    expect(secretsMatch('', '')).toBe(false);
    expect(secretsMatch(null, 'atteso')).toBe(false);
    expect(secretsMatch(undefined, 'atteso')).toBe(false);
    expect(secretsMatch('qualcosa', null)).toBe(false);
  });
});

describe('acquireConnection: tetto alle connessioni SSE', () => {
  beforeEach(() => resetConnectionsForTests());

  it('oltre il limite per indirizzo la connessione viene rifiutata, e torna ammessa al rilascio', () => {
    const limiti = { perClient: 2, total: 10 };
    const prima = acquireConnection('ip:1', limiti);
    const seconda = acquireConnection('ip:1', limiti);
    const terza = acquireConnection('ip:1', limiti);
    expect(prima.allowed && seconda.allowed).toBe(true);
    expect(terza).toEqual({ allowed: false, reason: 'client' });
    // Un altro indirizzo non è penalizzato.
    expect(acquireConnection('ip:2', limiti).allowed).toBe(true);

    if (prima.allowed) {
      prima.release();
      // Il secondo rilascio della stessa connessione non libera un posto in più.
      prima.release();
    }
    expect(acquireConnection('ip:1', limiti).allowed).toBe(true);
    expect(acquireConnection('ip:1', limiti)).toEqual({ allowed: false, reason: 'client' });
  });

  it('il tetto complessivo ferma anche indirizzi diversi', () => {
    const limiti = { perClient: 5, total: 2 };
    expect(acquireConnection('ip:a', limiti).allowed).toBe(true);
    expect(acquireConnection('ip:b', limiti).allowed).toBe(true);
    expect(acquireConnection('ip:c', limiti)).toEqual({ allowed: false, reason: 'total' });
    expect(openConnections()).toEqual({ total: 2, clients: 2 });
  });
});
