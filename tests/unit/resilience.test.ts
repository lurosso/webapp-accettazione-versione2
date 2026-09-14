import { describe, expect, it } from 'vitest';
import { err, ok } from '@/domain/result';
import { CircuitBreaker } from '@/services/resilience/circuit-breaker';
import { retryDelayMs, withRetry } from '@/services/resilience/retry';
import { InfinityServiceResilient } from '@/services/resilience/InfinityServiceResilient';
import { providerError, type ProviderResult } from '@/services/interfaces/common';
import { InfinityServiceMock } from '@/services/mocks/InfinityServiceMock';
import type { InfinityMockMode } from '@/services/interfaces/mock-config';
import { NoopLogger } from '@/services/mocks/ConsoleLogger';
import { buildTestEnv, TEST_DATE, TestClock } from '../helpers/fixtures';

const rete = () => providerError('INFINITY', 'NETWORK', 'rete giù', true);
const richiestaErrata = () => providerError('INFINITY', 'INVALID_REQUEST', 'parametri', false);

describe('CircuitBreaker', () => {
  it('si apre dopo i guasti previsti e resta aperto per il periodo indicato', () => {
    let ora = 0;
    const cb = new CircuitBreaker({ failureThreshold: 3, openForMs: 60_000, now: () => ora });
    expect(cb.allows()).toBe(true);
    cb.recordFailure(rete());
    cb.recordFailure(rete());
    expect(cb.snapshot().state).toBe('CLOSED');
    cb.recordFailure(rete());
    expect(cb.snapshot().state).toBe('OPEN');
    expect(cb.allows()).toBe(false);

    ora = 59_000;
    expect(cb.allows()).toBe(false);
    ora = 60_000;
    // Scaduta l'attesa passa UNA chiamata di prova; le altre aspettano il suo esito.
    expect(cb.allows()).toBe(true);
    expect(cb.snapshot().state).toBe('HALF_OPEN');
    expect(cb.allows()).toBe(false);
  });

  it('la prova riuscita richiude, quella fallita riapre subito', () => {
    let ora = 0;
    const cb = new CircuitBreaker({ failureThreshold: 1, openForMs: 1_000, now: () => ora });
    cb.recordFailure(rete());
    ora = 1_000;
    expect(cb.allows()).toBe(true);
    cb.recordFailure(rete());
    expect(cb.snapshot().state).toBe('OPEN');

    ora = 2_000;
    expect(cb.allows()).toBe(true);
    cb.recordSuccess();
    expect(cb.snapshot()).toEqual({ state: 'CLOSED', consecutiveFailures: 0, retryAt: null });
  });

  it('gli errori del chiamante non aprono il circuito: il sistema esterno funziona', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, openForMs: 1_000, now: () => 0 });
    cb.recordFailure(richiestaErrata());
    expect(cb.snapshot().state).toBe('CLOSED');
    expect(cb.allows()).toBe(true);
  });
});

describe('withRetry', () => {
  it('ripete solo sugli errori ritentabili e restituisce il primo esito buono', async () => {
    let chiamate = 0;
    const esito = await withRetry<number>(
      async () => {
        chiamate += 1;
        return chiamate < 3 ? err(rete()) : ok(42);
      },
      { retries: 3, baseDelayMs: 100, sleep: async () => undefined, random: () => 0 },
    );
    expect(esito.ok && esito.value).toBe(42);
    expect(chiamate).toBe(3);
  });

  it('non insiste su un errore definitivo', async () => {
    let chiamate = 0;
    const esito: ProviderResult<number> = await withRetry<number>(
      async () => {
        chiamate += 1;
        return err(richiestaErrata());
      },
      { retries: 3, baseDelayMs: 100, sleep: async () => undefined },
    );
    expect(esito.ok).toBe(false);
    expect(chiamate).toBe(1);
  });

  it("l'attesa raddoppia a ogni ripetizione, con jitter, fino al tetto", () => {
    const opzioni = { retries: 5, baseDelayMs: 100, maxDelayMs: 350, jitterRatio: 0.5 };
    expect(retryDelayMs(1, opzioni, 0)).toBe(100);
    expect(retryDelayMs(2, opzioni, 0)).toBe(200);
    expect(retryDelayMs(3, opzioni, 0)).toBe(350);
    // Jitter: fino al 50 % in più dell'attesa di base.
    expect(retryDelayMs(1, opzioni, 1)).toBe(150);
  });
});

/** Porta Infinity finta avvolta dal decoratore: il mock in modalità `mode`, tempi a zero. */
function resiliente(mode: InfinityMockMode, clock: TestClock, retries = 0) {
  const env = buildTestEnv(clock);
  const inner = new InfinityServiceMock(
    {
      seed: 'resilienza',
      mode,
      latencyMs: 0,
      flakyFailures: 10,
      cancelOnSecondCall: false,
      brands: env.seed.brands,
      desks: env.seed.desks,
    },
    { clock, logger: new NoopLogger() },
  );
  const service = new InfinityServiceResilient(
    inner,
    {
      // Timeout minimo: la modalità "timeout" del mock attende il tempo concesso.
      timeoutMs: 5,
      retries,
      retryBaseDelayMs: 1,
      failureThreshold: 3,
      openForMs: 60_000,
      implementation: 'mock',
    },
    { clock, logger: new NoopLogger(), sleep: async () => undefined, random: () => 0 },
  );
  return { service, inner };
}

describe('InfinityServiceResilient', () => {
  it('dopo tre guasti di rete smette di chiamare Infinity e risponde CIRCUIT_OPEN', async () => {
    const clock = new TestClock();
    const { service } = resiliente('timeout', clock);

    for (let i = 0; i < 3; i += 1) {
      const r = await service.fetchDailyAgenda(TEST_DATE);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe('TIMEOUT');
      }
    }
    expect(service.circuit().state).toBe('OPEN');

    const bloccata = await service.fetchDailyAgenda(TEST_DATE);
    expect(bloccata.ok).toBe(false);
    if (!bloccata.ok) {
      expect(bloccata.error.code).toBe('CIRCUIT_OPEN');
      expect(bloccata.error.retryable).toBe(true);
    }

    // Lo stato di salute lo dice chiaramente, senza chiamare il DMS.
    const salute = await service.healthCheck();
    expect(salute.status).toBe('DOWN');
    expect(salute.detail).toContain('circuito aperto');
  });

  it('scaduta l’attesa riprova; se Infinity risponde il circuito si richiude', async () => {
    const clock = new TestClock();
    const { service, inner } = resiliente('flaky', clock);
    // Il mock "flaky" fallisce le prime chiamate poi risponde: qui si simula il DMS che riparte
    // cambiando il numero di guasti residui.
    for (let i = 0; i < 3; i += 1) {
      await service.fetchDailyAgenda(TEST_DATE);
    }
    expect(service.circuit().state).toBe('OPEN');

    (inner as unknown as { flakyRemaining: number }).flakyRemaining = 0;
    clock.advance(60_000);
    const riuscita = await service.fetchDailyAgenda(TEST_DATE);
    expect(riuscita.ok).toBe(true);
    expect(service.circuit().state).toBe('CLOSED');
  });

  it('con le ripetizioni attive un guasto passeggero non arriva al chiamante', async () => {
    const clock = new TestClock();
    const { service, inner } = resiliente('flaky', clock, 2);
    (inner as unknown as { flakyRemaining: number }).flakyRemaining = 2;

    const r = await service.fetchDailyAgenda(TEST_DATE);
    expect(r.ok).toBe(true);
    expect(service.circuit().consecutiveFailures).toBe(0);
  });

  it('un errore definitivo di Infinity non apre il circuito', async () => {
    const clock = new TestClock();
    const { service } = resiliente('error', clock);
    for (let i = 0; i < 5; i += 1) {
      await service.fetchDailyAgenda(TEST_DATE);
    }
    expect(service.circuit().state).toBe('CLOSED');
  });
});
