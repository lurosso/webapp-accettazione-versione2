import { describe, expect, it } from 'vitest';
import { QueueService } from '@/application/queue/QueueService';
import { CodeGenerator } from '@/application/queue/CodeGenerator';
import { InspectionArchiveService } from '@/application/media/InspectionArchiveService';
import { SyncScheduler } from '@/application/sync/SyncScheduler';
import { SyncService } from '@/application/sync/SyncService';
import { SYNC_RETRY_BACKOFF_MINUTES } from '@/config/constants';
import type { SyncTrigger } from '@/domain/entities/sync-run';
import type { InfinityMockMode } from '@/services/interfaces/mock-config';
import { InfinityServiceMock } from '@/services/mocks/InfinityServiceMock';
import { buildTestEnv, TEST_DATE, TestClock } from '../helpers/fixtures';

/**
 * Scheduler con Infinity nella modalità indicata. L'orologio parte alle 10:00 locali, quindi
 * la sync delle 06:00 è dovuta; la chiusura di fine turno è spostata a fine giornata per non
 * interferire. Le chiamate a `runDailySync` vengono contate per tipo di innesco.
 */
function setup(mode: InfinityMockMode) {
  const clock = new TestClock('2026-09-10T08:00:00.000Z');
  const env = buildTestEnv(clock);
  const infinity = new InfinityServiceMock(
    {
      seed: 'retry-sync',
      mode,
      latencyMs: 0,
      flakyFailures: 0,
      cancelOnSecondCall: false,
      brands: env.seed.brands,
      desks: env.seed.desks,
    },
    { clock, logger: env.logger },
  );
  const syncService = new SyncService({
    infinity,
    appointments: env.appointments,
    syncRuns: env.syncRuns,
    referenceData: env.referenceData,
    codeGenerator: new CodeGenerator(env.appointments, { sitePrefix: 'F', scope: 'SITE' }),
    eventBus: env.eventBus,
    clock,
    ids: env.ids,
    logger: env.logger,
    timeZone: 'Europe/Rome',
  });
  const inneschi: SyncTrigger[] = [];
  const spia = {
    runDailySync: (date: typeof TEST_DATE, trigger: SyncTrigger) => {
      inneschi.push(trigger);
      return syncService.runDailySync(date, trigger);
    },
    getLatestRun: (date: typeof TEST_DATE) => syncService.getLatestRun(date),
  } as unknown as SyncService;
  const queueService = new QueueService({
    appointments: env.appointments,
    referenceData: env.referenceData,
    operators: env.operators,
    notifications: env.notifications,
    crmNotifier: env.crmNotifier,
    eventBus: env.eventBus,
    clock,
    ids: env.ids,
    logger: env.logger,
  });
  const scheduler = new SyncScheduler({
    syncService: spia,
    syncRuns: env.syncRuns,
    queueService,
    appointments: env.appointments,
    archive: new InspectionArchiveService({
      appointments: env.appointments,
      media: env.media,
      mediaStorage: env.mediaStorage,
      referenceData: env.referenceData,
      clock,
      logger: env.logger,
      hardDeleteDays: 90,
    }),
    clock,
    logger: env.logger,
    syncHourLocal: '06:00',
    businessDayEndLocal: '23:59',
    timeZone: 'Europe/Rome',
  });
  return { env, clock, scheduler, inneschi };
}

describe('SyncScheduler: nuovo tentativo automatico dopo una sync fallita', () => {
  it('con Infinity giù la prima sync fallisce e viene ritentata dopo l’attesa prevista', async () => {
    const { env, clock, scheduler, inneschi } = setup('error');

    await scheduler.tick('SCHEDULED');
    expect(inneschi).toEqual(['SCHEDULED']);
    expect((await env.syncRuns.findLatest(TEST_DATE))?.status).toBe('FAILED');

    // Un minuto dopo: troppo presto, nessun nuovo tentativo.
    clock.advance(60_000);
    await scheduler.tick('SCHEDULED');
    expect(inneschi).toEqual(['SCHEDULED']);

    // Scaduta la prima attesa: parte il RETRY.
    clock.advance(SYNC_RETRY_BACKOFF_MINUTES[0]! * 60_000);
    await scheduler.tick('SCHEDULED');
    expect(inneschi).toEqual(['SCHEDULED', 'RETRY']);
    expect((await env.syncRuns.findLatest(TEST_DATE))?.trigger).toBe('RETRY');
  });

  it('dopo i tentativi previsti smette da solo: resta il pulsante "Riprova" della dashboard', async () => {
    const { clock, scheduler, inneschi } = setup('error');
    await scheduler.tick('SCHEDULED');

    for (const minuti of SYNC_RETRY_BACKOFF_MINUTES) {
      clock.advance((minuti + 1) * 60_000);
      await scheduler.tick('SCHEDULED');
    }
    expect(inneschi.filter((t) => t === 'RETRY')).toHaveLength(SYNC_RETRY_BACKOFF_MINUTES.length);

    // Ore dopo: niente altri tentativi automatici.
    clock.advance(6 * 60 * 60_000);
    await scheduler.tick('SCHEDULED');
    expect(inneschi.filter((t) => t === 'RETRY')).toHaveLength(SYNC_RETRY_BACKOFF_MINUTES.length);
  });

  it('una sync riuscita non viene ripetuta', async () => {
    const { clock, scheduler, inneschi } = setup('ok');
    await scheduler.tick('SCHEDULED');
    clock.advance(60 * 60_000);
    await scheduler.tick('SCHEDULED');
    expect(inneschi).toEqual(['SCHEDULED']);
  });
});
