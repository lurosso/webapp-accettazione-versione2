// Copia notturna del database nel giro dello scheduler (M8-T58): una volta al giorno dall'ora
// configurata, non se c'è già, mai con la persistenza in memoria, e un guasto non ferma la sync.
import { describe, expect, it } from 'vitest';
import { InspectionArchiveService } from '@/application/media/InspectionArchiveService';
import { CodeGenerator } from '@/application/queue/CodeGenerator';
import { QueueService } from '@/application/queue/QueueService';
import { SyncScheduler } from '@/application/sync/SyncScheduler';
import { SyncService } from '@/application/sync/SyncService';
import { parseEnv } from '@/config/env';
import type { IsoDate } from '@/domain/value-objects/iso-date';
import type { IDatabaseBackup } from '@/repositories/interfaces';
import { InfinityServiceMock } from '@/services/mocks/InfinityServiceMock';
import { buildTestEnv, TEST_DATE, TestClock } from '../helpers/fixtures';

/** Copia finta che conta le chiamate; `fallisci` la fa lanciare. */
function copiaFinta(opzioni: { supported?: boolean; giaFatta?: boolean; fallisci?: boolean } = {}) {
  const fatte: IsoDate[] = [];
  const backup: IDatabaseBackup = {
    supported: opzioni.supported ?? true,
    hasBackupFor: async () => opzioni.giaFatta ?? false,
    backup: async (giorno) => {
      if (opzioni.fallisci === true) {
        throw new Error('disco pieno');
      }
      fatte.push(giorno);
      return { file: `/data/backup/accettazione-${giorno}.db`, bytes: 1, removed: 0 };
    },
  };
  return { backup, fatte };
}

function setup(ora: string, backup: IDatabaseBackup, orario: string | null = '02:30') {
  const clock = new TestClock(ora);
  const env = buildTestEnv(clock);
  const syncService = new SyncService({
    infinity: new InfinityServiceMock(
      {
        seed: 'copia',
        mode: 'ok',
        latencyMs: 0,
        flakyFailures: 0,
        cancelOnSecondCall: false,
        brands: env.seed.brands,
        desks: env.seed.desks,
      },
      { clock, logger: env.logger },
    ),
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
  const scheduler = new SyncScheduler({
    syncService,
    syncRuns: env.syncRuns,
    queueService: new QueueService({
      appointments: env.appointments,
      referenceData: env.referenceData,
      operators: env.operators,
      notifications: env.notifications,
      crmNotifier: env.crmNotifier,
      eventBus: env.eventBus,
      clock,
      ids: env.ids,
      logger: env.logger,
    }),
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
    databaseBackup: backup,
    databaseBackupTimeLocal: orario,
  });
  return { env, clock, scheduler };
}

// 00:15 UTC = 02:15 a Roma (prima della copia); 08:00 UTC = 10:00 (dopo copia e sync).
const PRIMA = '2026-09-10T00:15:00.000Z';
const DOPO = '2026-09-10T08:00:00.000Z';

describe('Copia notturna del database nello scheduler', () => {
  it('parte una volta al giorno dall’ora configurata, anche in ritardo dopo un riavvio', async () => {
    const { backup, fatte } = copiaFinta();
    const { clock, scheduler } = setup(PRIMA, backup);
    await scheduler.tick('SCHEDULED');
    expect(fatte).toEqual([]);
    clock.advance(20 * 60_000); // 02:35
    await scheduler.tick('SCHEDULED');
    expect(fatte).toEqual([TEST_DATE]);
    clock.advance(60 * 60_000);
    await scheduler.tick('SCHEDULED');
    expect(fatte).toEqual([TEST_DATE]);

    const riavvio = copiaFinta();
    await setup(DOPO, riavvio.backup).scheduler.tick('BOOTSTRAP');
    expect(riavvio.fatte).toEqual([TEST_DATE]);
  });

  it('non la rifà se c’è già, e non la fa con la persistenza in memoria o spenta', async () => {
    for (const [backup, orario] of [
      [copiaFinta({ giaFatta: true }), '02:30'],
      [copiaFinta({ supported: false }), '02:30'],
      [copiaFinta(), null],
    ] as const) {
      await setup(DOPO, backup.backup, orario).scheduler.tick('SCHEDULED');
      expect(backup.fatte).toEqual([]);
    }
  });

  it('se la copia non riesce, la sync della mattina parte lo stesso', async () => {
    const { env, scheduler } = setup(DOPO, copiaFinta({ fallisci: true }).backup);
    await scheduler.tick('SCHEDULED');
    expect((await env.syncRuns.findLatest(TEST_DATE))?.status).toBe('SUCCESS');
  });

  it('configurazione: accesa di serie alle 02:30 per 14 giorni; spegnibile', () => {
    expect(parseEnv({})).toMatchObject({
      dbBackupTimeLocal: '02:30',
      dbBackupKeepDays: 14,
      dbBackupDir: null,
    });
    expect(parseEnv({ DB_BACKUP_ENABLED: 'false' }).dbBackupTimeLocal).toBeNull();
    expect(
      parseEnv({ DB_BACKUP_TIME: '03:15', DB_BACKUP_KEEP_DAYS: '30', DB_BACKUP_DIR: '/data/b' }),
    ).toMatchObject({ dbBackupTimeLocal: '03:15', dbBackupKeepDays: 30, dbBackupDir: '/data/b' });
  });
});
