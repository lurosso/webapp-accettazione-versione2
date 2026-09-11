import { describe, expect, it } from 'vitest';
import { QueueService, type ActionContext } from '@/application/queue/QueueService';
import type { Appointment } from '@/domain/entities/appointment';
import { asBayId, asOperatorId, asWorkstationId } from '@/domain/ids';
import { buildTestEnv, makeAppointment, TEST_DATE } from '../helpers/fixtures';

function setup() {
  const env = buildTestEnv();
  const service = new QueueService({
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
  const ctx: ActionContext = {
    operatorId: asOperatorId('op-advisor-1'),
    workstationId: asWorkstationId('ws-p1'),
    correlationId: 'corr-board',
  };
  return { env, service, ctx };
}

async function insert(env: ReturnType<typeof buildTestEnv>, a: Appointment): Promise<Appointment> {
  const r = await env.appointments.insert(a);
  if (!r.ok) {
    throw new Error(r.error.message);
  }
  return r.value;
}

const AT = (hhmm: string) => `2026-09-10T${hhmm}:00.000Z` as Appointment['scheduledAt'];

describe('QueueService.getWaitingBoard', () => {
  it('tabellone vuoto quando non c’è nessuno in officina', async () => {
    const { service } = setup();
    const board = await service.getWaitingBoard(TEST_DATE);
    expect(board.serving).toHaveLength(0);
    expect(board.next).toHaveLength(0);
    expect(board.waitingCount).toBe(0);
  });

  it('mostra i codici chiamati con la campata e i prossimi in attesa', async () => {
    const { env, service, ctx } = setup();
    const primo = await insert(env, makeAppointment({ scheduledAt: AT('07:00') }));
    const secondo = await insert(env, makeAppointment({ scheduledAt: AT('07:15') }));
    await insert(env, makeAppointment({ scheduledAt: AT('07:30') }));
    await insert(env, makeAppointment({ scheduledAt: AT('07:45') }));

    await service.takeInCharge(
      { appointmentId: primo.id, expectedVersion: 1, bayId: asBayId('bay-c1') },
      ctx,
    );
    env.clock.advance(60_000);
    await service.takeInCharge(
      { appointmentId: secondo.id, expectedVersion: 1, bayId: asBayId('bay-c3') },
      ctx,
    );

    const board = await service.getWaitingBoard(TEST_DATE, 2);
    // La chiamata più recente va in cima: è quella che la sala deve notare.
    expect(board.serving.map((s) => s.code)).toEqual([secondo.code, primo.code]);
    expect(board.serving[0]?.bayNumber).toBe(3);
    expect(board.serving[1]?.bayNumber).toBe(1);
    expect(board.next).toHaveLength(2);
    expect(board.waitingCount).toBe(2);
  });

  it('il tabellone non espone targhe né nomi: solo codici e destinazione', async () => {
    const { env, service, ctx } = setup();
    const a = await insert(env, makeAppointment());
    await service.takeInCharge({ appointmentId: a.id, expectedVersion: 1, bayId: null }, ctx);

    const board = await service.getWaitingBoard(TEST_DATE);
    expect(Object.keys(board.serving[0] ?? {}).sort()).toEqual([
      'bayCode',
      'bayNumber',
      'code',
      'deskCode',
      'since',
    ]);
    const serialized = JSON.stringify(board);
    expect(serialized).not.toContain(a.vehicle.plate);
    expect(serialized).not.toContain(a.customer.lastName);
  });

  it('completando la pratica il codice esce dai chiamati', async () => {
    const { env, service, ctx } = setup();
    const a = await insert(env, makeAppointment());
    await service.takeInCharge({ appointmentId: a.id, expectedVersion: 1, bayId: null }, ctx);
    await service.complete({ appointmentId: a.id, expectedVersion: 2 }, ctx);

    const board = await service.getWaitingBoard(TEST_DATE);
    expect(board.serving).toHaveLength(0);
  });

  it('le pratiche saltate restano fra i prossimi turni', async () => {
    const { env, service, ctx } = setup();
    const a = await insert(env, makeAppointment({ scheduledAt: AT('07:00') }));
    await service.skip({ appointmentId: a.id, expectedVersion: 1 }, ctx);

    const board = await service.getWaitingBoard(TEST_DATE);
    expect(board.next.map((n) => n.code)).toEqual([a.code]);
    expect(board.waitingCount).toBe(1);
  });
});
