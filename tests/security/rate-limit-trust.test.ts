// Limiti di frequenza: fiducia negli header del proxy, contatore per indirizzo assente senza
// indirizzo affidabile, tetto alle chiavi vive.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clientIpFrom,
  combineRateLimits,
  hitPerIp,
  hitRateLimit,
  MAX_RATE_LIMIT_KEYS,
  RATE_LIMIT_ALLOWED,
  rateLimitKeyCountForTests,
  resetRateLimitForTests,
  setTrustProxyHeadersForTests,
} from '@/lib/http/rate-limit';

const RULE = { limit: 2, windowMs: 60_000 } as const;

describe('Sicurezza: limiti di frequenza e indirizzo del chiamante', () => {
  beforeEach(() => {
    resetRateLimitForTests();
  });
  afterEach(() => {
    setTrustProxyHeadersForTests(null);
  });

  it('senza proxy fidato X-Forwarded-For ruotato NON apre un contatore nuovo a ogni richiesta', () => {
    setTrustProxyHeadersForTests(false);
    for (let i = 0; i < 50; i += 1) {
      const h = new Headers({ 'x-forwarded-for': `10.0.${Math.floor(i / 256)}.${i % 256}` });
      expect(clientIpFrom(h)).toBeNull();
      expect(hitPerIp('ip', h, RULE)).toBe(RATE_LIMIT_ALLOWED);
    }
    expect(rateLimitKeyCountForTests()).toBe(0);
  });

  it('dietro proxy fidato il contatore per indirizzo vale e usa il valore messo dal proxy', () => {
    setTrustProxyHeadersForTests(true);
    const h = new Headers({ 'x-forwarded-for': '9.9.9.9, 172.16.0.5' });
    expect(hitPerIp('ip', h, RULE, 1_000).allowed).toBe(true);
    expect(hitPerIp('ip', h, RULE, 1_001).allowed).toBe(true);
    expect(hitPerIp('ip', h, RULE, 1_002).allowed).toBe(false);
    // Cambiare il PRIMO valore (quello del client) non cambia nulla: conta l'ultimo.
    const finto = new Headers({ 'x-forwarded-for': '1.1.1.1, 172.16.0.5' });
    expect(hitPerIp('ip', finto, RULE, 1_003).allowed).toBe(false);
  });

  it('il tetto globale a chiave costante scatta anche se ogni richiesta arriva da un indirizzo diverso', () => {
    setTrustProxyHeadersForTests(true);
    const GLOBALE = { limit: 3, windowMs: 60_000 } as const;
    const esiti = [];
    for (let i = 0; i < 4; i += 1) {
      const h = new Headers({ 'x-forwarded-for': `10.0.0.${i}` });
      esiti.push(
        combineRateLimits(
          hitRateLimit('prova:globale', GLOBALE, 5_000),
          hitPerIp('prova-ip', h, RULE, 5_000),
        ),
      );
    }
    expect(esiti.map((e) => e.allowed)).toEqual([true, true, true, false]);
  });

  it('le chiavi vive non crescono senza limite: oltre il tetto si puliscono e si scartano le più vecchie', () => {
    for (let i = 0; i <= MAX_RATE_LIMIT_KEYS + 5; i += 1) {
      hitRateLimit(`token:${i}`, RULE, 10_000);
    }
    expect(rateLimitKeyCountForTests()).toBeLessThan(MAX_RATE_LIMIT_KEYS);
    // Le finestre scadute spariscono alla pulizia successiva.
    resetRateLimitForTests();
    hitRateLimit('vecchia', RULE, 0);
    for (let i = 0; i < 1_000; i += 1) {
      hitRateLimit(`nuova:${i}`, RULE, RULE.windowMs + 10);
    }
    expect(rateLimitKeyCountForTests()).toBeLessThanOrEqual(1_000);
  });
});
