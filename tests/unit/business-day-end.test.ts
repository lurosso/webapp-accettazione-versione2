import { describe, expect, it } from 'vitest';
import { QueueService, type ActionContext } from '@/application/queue/QueueService';
import { SyncScheduler } from '@/application/sync/SyncScheduler';
import { SyncService } from '@/application/sync/SyncService';
import { CodeGenerator } from '@/application/queue/CodeGenerator';
import { InfinityServiceMock } from '@/services/mocks/InfinityServiceMock';
import type { Appointment } from '@/domain/entities/appointment';
import { asOperatorId, asWorkstationId } from '@/domain/ids';
import { buildTestEnv, makeAppointment, TEST_DATE, TestClock } from '../helpers/fixtures';

/**
 * Ambiente dello scheduler della giornata. L'orologio dei test è fermo: si sposta a mano prima e
 * dopo l'orario di fine turno per verificare che la chiusura scatti quando deve, e una volta sola.
 */
function setup(clock: TestClock) {
  const env = buildTestEnv(clock);
  const queueService = new QueueService({
    appointments: env.appointments,
    referenceData: env.referenceData,
    operators: env.operators,
    notifications: env.notifications,
    crmNotifier: env.crmNotifier,
    eventBus: env.eventBus,
    clock: env.clock,
    ids: env.ids,
    logger: env.logger,
  });
  const infinity = new InfinityServiceMock(
    {
      seed: 'fine-turno',
      mode: 'ok',
      latencyMs: 0,
      flakyFailures: 0,
      cancelOnSecondCall: false,
      brands: env.seed.brands,
      desks: env.seed.desks,
    },
    { clock: env.clock, logger: env.logger },
  );
  const syncService = new SyncService({
    infinity,
    appointments: env.appointments,
    syncRuns: env.syncRuns,
    referenceData: env.referenceData,
    codeGenerator: new CodeGenerator(env.appointments, { sitePrefix: 'F', scope: 'SITE' }),
    eventBus: env.eventBus,
    clock: env.clock,
    ids: env.ids,
    logger: env.logger,
    timeZone: 'Europe/Rome',
    notifications: env.orchestrator,
  });
  const scheduler = new SyncScheduler({
    syncService,
    syncRuns: env.syncRuns,
    queueService,
    appointments: env.appointments,
    clock: env.clock,
    logger: env.logger,
    // Sincronizzazione spostata a fine giornata: questi test guardano solo la chiusura, e una
    // sync nel mezzo annullerebbe le pratiche inserite a mano (non sono nell'agenda del mock).
    syncHourLocal: '23:59',
    businessDayEndLocal: '19:00',
    timeZone: 'Europe/Rome',
  });
  const ctx: ActionContext = {
    operatorId: asOperatorId('op-advisor-1'),
    workstationId: asWorkstationId('ws-p1'),
    correlationId: 'corr-fine-turno',
  };
  return { env, queueService, scheduler, ctx };
}

async function insert(env: ReturnType<typeof buildTestEnv>, a: Appointment): Promise<Appointment> {
  const r = await env.appointments.insert(a);
  if (!r.ok) {
    throw new Error(r.error.message);
  }
  return r.value;
}

/** Orologio alle 16:00 locali (14:00 UTC): officina aperta. */
const durante = (): TestClock => new TestClock('2026-09-10T14:00:00.000Z');
/** Orologio alle 19:30 locali (17:30 UTC): officina chiusa. */
const dopoChiusura = (): TestClock => new TestClock('2026-09-10T17:30:00.000Z');

describe('SyncScheduler: chiusura automatica di fine turno', () => {
  it('prima dell’orario di fine turno non chiude nulla', async () => {
    const { env, scheduler } = setup(durante());
    const a = await insert(env, makeAppointment());

    await scheduler.tick('SCHEDULED');

    expect((await env.appointments.findById(a.id))?.status).toBe('WAITING');
  });

  it('dopo l’orario di fine turno chiude la giornata rimasta aperta', async () => {
    const clock = dopoChiusura();
    const { env, queueService, scheduler, ctx } = setup(clock);
    const inAttesa = await insert(env, makeAppointment());
    const inCarico = await insert(env, makeAppointment());
    await queueService.takeInCharge(
      { appointmentId: inCarico.id, expectedVersion: 1, bayId: null },
      ctx,
    );

    await scheduler.tick('SCHEDULED');

    expect((await env.appointments.findById(inAttesa.id))?.status).toBe('NO_SHOW');
    expect((await env.appointments.findById(inCarico.id))?.status).toBe('CANCELLED');
    // L'assente della chiusura automatica arriva comunque al CRM: domani il BDC lo richiama.
    expect(env.crm.received).toHaveLength(1);
  });

  it('la chiusura automatica è registrata come azione di sistema, non di un operatore', async () => {
    const clock = dopoChiusura();
    const { env, scheduler } = setup(clock);
    await insert(env, makeAppointment());

    await scheduler.tick('SCHEDULED');

    const chiusura = env.eventBus.listSince(0).find((e) => e.type === 'BUSINESS_DAY_CLOSED');
    expect(chiusura?.actor).toEqual({ kind: 'SYSTEM', id: null });
    const cambioStato = env.eventBus
      .listSince(0)
      .find((e) => e.type === 'APPOINTMENT_STATUS_CHANGED');
    expect(cambioStato?.actor.kind).toBe('SYSTEM');
  });

  it('non chiude due volte: al secondo tick non succede nulla', async () => {
    const clock = dopoChiusura();
    const { env, scheduler } = setup(clock);
    await insert(env, makeAppointment());

    await scheduler.tick('SCHEDULED');
    await scheduler.tick('SCHEDULED');

    const chiusure = env.eventBus.listSince(0).filter((e) => e.type === 'BUSINESS_DAY_CLOSED');
    expect(chiusure).toHaveLength(1);
  });

  it('se il responsabile ha già chiuso a mano, il fine turno non aggiunge un’altra chiusura', async () => {
    const clock = dopoChiusura();
    const { env, queueService, scheduler, ctx } = setup(clock);
    await insert(env, makeAppointment());
    await queueService.closeBusinessDay(TEST_DATE, ctx);

    await scheduler.tick('SCHEDULED');

    const chiusure = env.eventBus.listSince(0).filter((e) => e.type === 'BUSINESS_DAY_CLOSED');
    // Solo quella del responsabile: lo scheduler non trova niente di aperto e resta zitto.
    expect(chiusure).toHaveLength(1);
    expect(chiusure[0]?.actor.kind).toBe('OPERATOR');
  });

  it('una giornata senza pratiche aperte non produce eventi', async () => {
    const clock = dopoChiusura();
    const { env, scheduler } = setup(clock);

    await scheduler.tick('SCHEDULED');

    expect(env.eventBus.listSince(0).filter((e) => e.type === 'BUSINESS_DAY_CLOSED')).toHaveLength(
      0,
    );
  });
});
