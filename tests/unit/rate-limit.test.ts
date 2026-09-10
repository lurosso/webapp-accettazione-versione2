import { beforeEach, describe, expect, it } from 'vitest';
import { POLLING_MS, PUBLIC_STATUS_RATE_LIMIT } from '@/config/constants';
import { clientIpFrom, hitRateLimit, resetRateLimitForTests } from '@/lib/http/rate-limit';

const RULE = { limit: 3, windowMs: 60_000 } as const;

describe('rate-limit', () => {
  beforeEach(() => {
    resetRateLimitForTests();
  });

  it('consente fino al limite e poi respinge indicando i secondi di attesa', () => {
    const now = 1_000_000;
    for (let i = 0; i < RULE.limit; i += 1) {
      const r = hitRateLimit('ip:1.2.3.4', RULE, now + i);
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(RULE.limit - i - 1);
    }
    const blocked = hitRateLimit('ip:1.2.3.4', RULE, now + 10);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('la finestra scorre: passato il minuto le richieste ripartono', () => {
    const now = 2_000_000;
    for (let i = 0; i < RULE.limit; i += 1) {
      hitRateLimit('ip:5.6.7.8', RULE, now);
    }
    expect(hitRateLimit('ip:5.6.7.8', RULE, now).allowed).toBe(false);
    expect(hitRateLimit('ip:5.6.7.8', RULE, now + RULE.windowMs + 1).allowed).toBe(true);
  });

  it('le chiavi sono indipendenti: due clienti non si bloccano a vicenda', () => {
    const now = 3_000_000;
    for (let i = 0; i < RULE.limit; i += 1) {
      hitRateLimit('targa:AB123CD', RULE, now);
    }
    expect(hitRateLimit('targa:AB123CD', RULE, now).allowed).toBe(false);
    expect(hitRateLimit('targa:EF456GH', RULE, now).allowed).toBe(true);
  });

  it('i limiti del portale stanno sopra il polling legittimo della pagina di stato', () => {
    // Una scheda aperta genera 60_000 / POLLING_MS.portal richieste al minuto sulla stessa targa:
    // se il limite scendesse sotto questa soglia il portale bloccherebbe i clienti, non gli abusi.
    const perMinutePerTab = PUBLIC_STATUS_RATE_LIMIT.windowMs / POLLING_MS.portal;
    expect(PUBLIC_STATUS_RATE_LIMIT.perPlate).toBeGreaterThanOrEqual(perMinutePerTab * 2);
    expect(PUBLIC_STATUS_RATE_LIMIT.perIp).toBeGreaterThanOrEqual(
      PUBLIC_STATUS_RATE_LIMIT.perPlate,
    );
  });

  it("ricava l'indirizzo del cliente dagli header del proxy", () => {
    expect(clientIpFrom(new Headers({ 'x-forwarded-for': '10.0.0.9, 172.16.0.1' }))).toBe(
      '10.0.0.9',
    );
    expect(clientIpFrom(new Headers({ 'x-real-ip': '10.0.0.7' }))).toBe('10.0.0.7');
    expect(clientIpFrom(new Headers())).toBe('sconosciuto');
  });
});
