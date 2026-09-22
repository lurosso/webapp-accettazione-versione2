// Diagnostica della pagina Sistema: ogni riga ha stato e codice coerenti, la sonda sullo storage
// non lascia tracce, e la sincronizzazione racconta l'ultima esecuzione della giornata.
import { describe, expect, it } from 'vitest';
import { SystemDiagnosticsService } from '@/application/system/SystemDiagnosticsService';
import type { SyncRun } from '@/domain/entities/sync-run';
import { asSyncRunId } from '@/domain/ids';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import { buildTestEnv } from '../helpers/fixtures';
import { InfinityServiceMock } from '@/services/mocks/InfinityServiceMock';

function setup() {
  const env = buildTestEnv();
  const infinity = new InfinityServiceMock(
    {
      mode: 'ok',
      latencyMs: 0,
      flakyFailures: 0,
      cancelOnSecondCall: false,
      seed: 'diag',
      brands: env.seed.brands,
      desks: env.seed.desks,
    },
    { clock: env.clock, logger: env.logger },
  );
  const service = new SystemDiagnosticsService({
    external: { infinity, spoki: env.spoki, smsHosting: env.smsHosting, crm: env.crm },
    kinds: { INFINITY: 'mock', SPOKI: 'mock', SMS_HOSTING: 'mock', CRM: 'mock' },
    mediaStorage: env.mediaStorage,
    syncRuns: env.syncRuns,
    clock: env.clock,
    ids: env.ids,
    logger: env.logger,
    timeZone: 'Europe/Rome',
  });
  return { env, service };
}

function run(
  env: ReturnType<typeof buildTestEnv>,
  status: SyncRun['status'],
  errorMessage: string | null = null,
): SyncRun {
  return {
    id: asSyncRunId(`run-${status}`),
    businessDate: env.clock.today(),
    trigger: 'SCHEDULED',
    status,
    startedAt: env.clock.nowIso(),
    finishedAt: status === 'RUNNING' ? null : ('2026-09-10T06:05:00.000Z' as IsoDateTime),
    counters: {
      fetched: 12,
      created: 3,
      updated: 2,
      unchanged: 7,
      cancelled: 0,
      rejected: status === 'PARTIAL' ? 2 : 0,
    },
    errorCode: errorMessage === null ? null : 'ODBC',
    errorMessage,
    correlationId: 'c',
    triggeredByOperatorId: null,
  };
}

describe('Diagnostica di sistema', () => {
  it('senza sincronizzazione oggi la riga è sconosciuta con codice SYNC-NONE; le porte mock sono operative', async () => {
    const { service } = setup();
    const d = await service.run();
    const sync = d.rows.find((r) => r.component === 'SYNC');
    expect(sync?.status).toBe('UNKNOWN');
    expect(sync?.code).toBe('SYNC-NONE');
    for (const c of ['INFINITY', 'SPOKI', 'SMS_HOSTING', 'CRM'] as const) {
      const riga = d.rows.find((r) => r.component === c);
      expect(riga?.status).toBe('UP');
      expect(riga?.code).toBeNull();
      expect(riga?.implementation).toBe('mock');
    }
    expect(d.overall).toBe('DEGRADED');
  });

  it('la sonda sullo storage scrive, rilegge e cancella: alla fine non resta nulla', async () => {
    const { service, env } = setup();
    const d = await service.run();
    const storage = d.rows.find((r) => r.component === 'MEDIA_STORAGE');
    expect(storage?.status).toBe('UP');
    expect(storage?.code).toBeNull();
    expect(storage?.detail).toContain('Scrittura e lettura');
    expect(env.mediaStorage.size).toBe(0);
  });

  it('la sincronizzazione racconta l’ultima esecuzione: fallita → rossa, parziale → gialla, riuscita → verde', async () => {
    const { service, env } = setup();
    await env.syncRuns.insert(run(env, 'FAILED', 'Infinity non raggiungibile'));
    let sync = (await service.run()).rows.find((r) => r.component === 'SYNC');
    expect(sync?.status).toBe('DOWN');
    expect(sync?.code).toBe('SYNC-FAILED');
    expect(sync?.detail).toContain('Infinity non raggiungibile');

    env.clock.advance(60_000);
    await env.syncRuns.insert({ ...run(env, 'PARTIAL'), id: asSyncRunId('run-partial-2') });
    sync = (await service.run()).rows.find((r) => r.component === 'SYNC');
    expect(sync?.status).toBe('DEGRADED');
    expect(sync?.code).toBe('SYNC-PARTIAL');

    env.clock.advance(60_000);
    await env.syncRuns.insert({ ...run(env, 'SUCCESS'), id: asSyncRunId('run-ok-3') });
    const d = await service.run();
    sync = d.rows.find((r) => r.component === 'SYNC');
    expect(sync?.status).toBe('UP');
    expect(sync?.code).toBeNull();
    expect(sync?.detail).toContain('12 pratiche lette');
    expect(d.overall).toBe('UP');
  });
});
