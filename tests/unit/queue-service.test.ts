import { describe, expect, it } from 'vitest';
import { QueueService, type ActionContext } from '@/application/queue/QueueService';
import type { Appointment } from '@/domain/entities/appointment';
import { asBayId, asBrandId, asDeskId, asOperatorId, asWorkstationId } from '@/domain/ids';
import { buildTestEnv, makeAppointment, TEST_DATE } from '../helpers/fixtures';

function setup() {
  const env = buildTestEnv();
  const service = new QueueService({
    appointments: env.appointments,
    referenceData: env.referenceData,
    operators: env.operators,
    eventBus: env.eventBus,
    clock: env.clock,
    ids: env.ids,
    logger: env.logger,
  });
  const ctx: ActionContext = {
    operatorId: asOperatorId('op-advisor-1'),
    workstationId: asWorkstationId('ws-p1'),
    correlationId: 'corr-1',
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

describe('QueueService', () => {
  it("prende in carico usando la campata predefinita della postazione e pubblica l'evento", async () => {
    const { env, service, ctx } = setup();
    const a = await insert(env, makeAppointment());
    const r = await service.takeInCharge(
      { appointmentId: a.id, expectedVersion: a.version, bayId: null },
      ctx,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('IN_PROGRESS');
      expect(r.value.bayId).toBe(asBayId('bay-c1'));
      expect(r.value.operatorId).toBe(ctx.operatorId);
      expect(r.value.takenAt).not.toBeNull();
      expect(r.value.version).toBe(2);
    }
    const events = env.eventBus.listSince(0);
    expect(
      events.some((e) => e.type === 'APPOINTMENT_STATUS_CHANGED' && e.to === 'IN_PROGRESS'),
    ).toBe(true);
  });

  it('se la campata predefinita è occupata sceglie la prima libera; una campata richiesta occupata → BAY_BUSY', async () => {
    const { env, service, ctx } = setup();
    const first = await insert(env, makeAppointment());
    const second = await insert(env, makeAppointment());
    await service.takeInCharge({ appointmentId: first.id, expectedVersion: 1, bayId: null }, ctx);

    const auto = await service.takeInCharge(
      { appointmentId: second.id, expectedVersion: 1, bayId: null },
      ctx,
    );
    expect(auto.ok).toBe(true);
    if (auto.ok) {
      expect(auto.value.bayId).toBe(asBayId('bay-c2'));
    }

    const third = await insert(env, makeAppointment());
    const busy = await service.takeInCharge(
      { appointmentId: third.id, expectedVersion: 1, bayId: asBayId('bay-c1') },
      ctx,
    );
    expect(busy.ok).toBe(false);
    if (!busy.ok) {
      expect(busy.error.code).toBe('BAY_BUSY');
      const freeBays = busy.error.details?.['freeBays'] as { code: string }[];
      expect(freeBays.map((b) => b.code)).toEqual(['C3', 'C4']);
    }
  });

  it('salta, ripristina e completa rispettando la state machine', async () => {
    const { env, service, ctx } = setup();
    const a = await insert(env, makeAppointment());

    const skipped = await service.skip({ appointmentId: a.id, expectedVersion: 1 }, ctx);
    expect(skipped.ok && skipped.value.status === 'SKIPPED' && skipped.value.skipCount === 1).toBe(
      true,
    );

    const completeFromSkipped = await service.complete(
      { appointmentId: a.id, expectedVersion: 2 },
      ctx,
    );
    expect(completeFromSkipped.ok).toBe(false);
    if (!completeFromSkipped.ok) {
      expect(completeFromSkipped.error.code).toBe('INVALID_TRANSITION');
    }

    const restored = await service.restore({ appointmentId: a.id, expectedVersion: 2 }, ctx);
    expect(
      restored.ok && restored.value.status === 'WAITING' && restored.value.skipCount === 1,
    ).toBe(true);

    const taken = await service.takeInCharge(
      { appointmentId: a.id, expectedVersion: 3, bayId: null },
      ctx,
    );
    expect(taken.ok).toBe(true);
    const completed = await service.complete({ appointmentId: a.id, expectedVersion: 4 }, ctx);
    expect(
      completed.ok &&
        completed.value.status === 'COMPLETED' &&
        completed.value.completedAt !== null,
    ).toBe(true);

    const occupancy = await service.getBayOccupancy(TEST_DATE);
    expect(occupancy.every((o) => o.appointment === null)).toBe(true);
  });

  it('versione obsoleta → VERSION_CONFLICT (due postazioni sulla stessa pratica)', async () => {
    const { env, service, ctx } = setup();
    const a = await insert(env, makeAppointment());
    await service.takeInCharge({ appointmentId: a.id, expectedVersion: 1, bayId: null }, ctx);
    const other: ActionContext = {
      ...ctx,
      operatorId: asOperatorId('op-advisor-2'),
      workstationId: asWorkstationId('ws-p3'),
    };
    const stale = await service.release({ appointmentId: a.id, expectedVersion: 1 }, other);
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.error.code).toBe('VERSION_CONFLICT');
    }
  });

  it('getQueue filtra per sportello (anche via marchio) e la vista globale mostra tutto', async () => {
    const { env, service } = setup();
    await insert(env, makeAppointment({ deskId: asDeskId('desk-s1') }));
    await insert(env, makeAppointment({ deskId: null, brandId: asBrandId('brand-lancia') }));
    await insert(
      env,
      makeAppointment({ deskId: asDeskId('desk-s2'), brandId: asBrandId('brand-jeep') }),
    );

    const s1 = await service.getQueue({
      businessDate: TEST_DATE,
      deskId: asDeskId('desk-s1'),
      globalView: false,
    });
    expect(s1).toHaveLength(2);
    const s2 = await service.getQueue({
      businessDate: TEST_DATE,
      deskId: asDeskId('desk-s2'),
      globalView: false,
    });
    expect(s2).toHaveLength(1);
    const all = await service.getQueue({
      businessDate: TEST_DATE,
      deskId: asDeskId('desk-s1'),
      globalView: true,
    });
    expect(all).toHaveLength(3);
    expect(all.every((row) => row.operatorName === null && row.bayCode === null)).toBe(true);
  });
});
