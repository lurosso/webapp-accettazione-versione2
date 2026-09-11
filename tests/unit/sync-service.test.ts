import { describe, expect, it } from 'vitest';
import { CodeGenerator } from '@/application/queue/CodeGenerator';
import { SyncService } from '@/application/sync/SyncService';
import type { InfinityMockMode } from '@/services/interfaces/mock-config';
import { InfinityServiceMock } from '@/services/mocks/InfinityServiceMock';
import { buildTestEnv, TEST_DATE } from '../helpers/fixtures';

function setup(mode: InfinityMockMode = 'ok') {
  const env = buildTestEnv();
  const infinity = new InfinityServiceMock(
    {
      seed: 'sync-test',
      mode,
      latencyMs: 0,
      flakyFailures: 1,
      cancelOnSecondCall: false,
      brands: env.seed.brands,
      desks: env.seed.desks,
    },
    { clock: env.clock, logger: env.logger },
  );
  const codeGenerator = new CodeGenerator(env.appointments, { sitePrefix: 'F', scope: 'SITE' });
  const service = new SyncService({
    infinity,
    appointments: env.appointments,
    syncRuns: env.syncRuns,
    referenceData: env.referenceData,
    codeGenerator,
    eventBus: env.eventBus,
    clock: env.clock,
    ids: env.ids,
    logger: env.logger,
    timeZone: 'Europe/Rome',
    notifications: env.orchestrator,
  });
  return { env, service };
}

describe('SyncService', () => {
  it('la prima sync crea le pratiche con F001… in ordine di orario; la seconda è idempotente', async () => {
    const { env, service } = setup();
    const first = await service.runDailySync(TEST_DATE, 'BOOTSTRAP');
    expect(first.status).toBe('SUCCESS');
    expect(first.counters.created).toBeGreaterThan(0);
    expect(first.counters.created).toBe(first.counters.fetched);

    const queue = await env.appointments.listByDate(TEST_DATE);
    expect(queue[0]?.code).toBe('F001');
    const codes = queue.map((a) => a.sequence);
    expect(codes).toEqual([...codes].sort((x, y) => x - y));

    env.clock.advance(60_000);
    const second = await service.runDailySync(TEST_DATE, 'MANUAL');
    expect(second.status).toBe('SUCCESS');
    expect(second.counters.created).toBe(0);
    expect(second.counters.unchanged).toBe(first.counters.created);
    expect(await env.syncRuns.findLatest(TEST_DATE)).toMatchObject({ id: second.id });
  });

  it('con Infinity in errore la SyncRun è FAILED e non lancia', async () => {
    const { env, service } = setup('error');
    const run = await service.runDailySync(TEST_DATE, 'SCHEDULED');
    expect(run.status).toBe('FAILED');
    expect(run.errorCode).not.toBeNull();
    expect(await env.appointments.listByDate(TEST_DATE)).toHaveLength(0);
  });

  it('due chiamate concorrenti per la stessa giornata condividono la stessa SyncRun', async () => {
    const { service } = setup();
    const [a, b] = await Promise.all([
      service.runDailySync(TEST_DATE, 'BOOTSTRAP'),
      service.runDailySync(TEST_DATE, 'MANUAL'),
    ]);
    expect(a.id).toBe(b.id);
  });
});
