import { describe, expect, it } from 'vitest';
import { QueueService, type ActionContext } from '@/application/queue/QueueService';
import type { Appointment } from '@/domain/entities/appointment';
import { asBrandId, asDeskId, asOperatorId, asWorkstationId } from '@/domain/ids';
import type { AheadScope } from '@/repositories/interfaces';
import { buildTestEnv, makeAppointment, TEST_DATE } from '../helpers/fixtures';

function setup(queueAheadScope: AheadScope = 'SITE') {
  const env = buildTestEnv();
  const service = new QueueService({
    appointments: env.appointments,
    referenceData: env.referenceData,
    operators: env.operators,
    eventBus: env.eventBus,
    clock: env.clock,
    ids: env.ids,
    logger: env.logger,
    queueAheadScope,
  });
  const ctx: ActionContext = {
    operatorId: asOperatorId('op-advisor-1'),
    workstationId: asWorkstationId('ws-p1'),
    correlationId: 'corr-portale',
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

describe('QueueService.getPublicPositionByPlate', () => {
  it('conta i clienti in attesa prima della pratica e non espone dati personali', async () => {
    const { env, service } = setup();
    await insert(env, makeAppointment({ scheduledAt: AT('07:00') }));
    await insert(env, makeAppointment({ scheduledAt: AT('07:15'), status: 'SKIPPED' }));
    const mine = await insert(env, makeAppointment({ scheduledAt: AT('07:30') }));
    await insert(env, makeAppointment({ scheduledAt: AT('08:00') }));

    const r = await service.getPublicPositionByPlate(mine.vehicle.plate, TEST_DATE);
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    // Le saltate contano come in attesa (default deciso in M2-T01); quella dopo non conta.
    expect(r.value.aheadCount).toBe(2);
    expect(r.value.code).toBe(mine.code);
    expect(r.value.status).toBe('WAITING');
    expect(r.value.bayNumber).toBeNull();
    expect(r.value.scheduledAt).toBe(mine.scheduledAt);
    // Nessun campo personale nella view pubblica.
    expect(Object.keys(r.value).sort()).toEqual([
      'aheadCount',
      'bayNumber',
      'brandCode',
      'code',
      'scheduledAt',
      'status',
      'updatedAt',
    ]);
  });

  it('normalizza la targa digitata dal cliente (minuscole, spazi, trattini)', async () => {
    const { env, service } = setup();
    const mine = await insert(env, makeAppointment());
    const plate = mine.vehicle.plate;
    const digitata = `${plate.slice(0, 2).toLowerCase()} ${plate.slice(2, 5)}-${plate.slice(5).toLowerCase()}`;
    const r = await service.getPublicPositionByPlate(digitata, TEST_DATE);
    expect(r.ok && r.value.code === mine.code).toBe(true);
  });

  it('in carico: conteggio azzerato e numero di campata da mostrare al cliente', async () => {
    const { env, service, ctx } = setup();
    await insert(env, makeAppointment({ scheduledAt: AT('07:00') }));
    const mine = await insert(env, makeAppointment({ scheduledAt: AT('07:30') }));

    const taken = await service.takeInCharge(
      { appointmentId: mine.id, expectedVersion: mine.version, bayId: null },
      ctx,
    );
    expect(taken.ok).toBe(true);

    const r = await service.getPublicPositionByPlate(mine.vehicle.plate, TEST_DATE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('IN_PROGRESS');
      expect(r.value.aheadCount).toBe(0);
      expect(r.value.bayNumber).toBe(1);
    }
  });

  it("l'ambito DESK conta solo lo sportello della pratica, SITE tutta l'accettazione", async () => {
    const other = {
      deskId: asDeskId('desk-s2'),
      brandId: asBrandId('brand-jeep'),
      scheduledAt: AT('07:00'),
    };
    const site = setup('SITE');
    await insert(site.env, makeAppointment(other));
    const mineSite = await insert(site.env, makeAppointment({ scheduledAt: AT('07:30') }));
    const rSite = await site.service.getPublicPositionByPlate(mineSite.vehicle.plate, TEST_DATE);
    expect(rSite.ok && rSite.value.aheadCount).toBe(1);

    const desk = setup('DESK');
    await insert(desk.env, makeAppointment(other));
    const mineDesk = await insert(desk.env, makeAppointment({ scheduledAt: AT('07:30') }));
    const rDesk = await desk.service.getPublicPositionByPlate(mineDesk.vehicle.plate, TEST_DATE);
    expect(rDesk.ok && rDesk.value.aheadCount).toBe(0);
  });

  it('targa non valida → VALIDATION, targa non in agenda → NOT_FOUND', async () => {
    const { service } = setup();
    const invalid = await service.getPublicPositionByPlate('AB1', TEST_DATE);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.error.code).toBe('VALIDATION');
    }
    const missing = await service.getPublicPositionByPlate('ZZ999ZZ', TEST_DATE);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error.code).toBe('NOT_FOUND');
      expect(missing.error.message).toContain('sportello');
    }
  });

  it('pratiche chiuse: stato riportato senza conteggio', async () => {
    const { env, service, ctx } = setup();
    const mine = await insert(env, makeAppointment());
    await service.takeInCharge({ appointmentId: mine.id, expectedVersion: 1, bayId: null }, ctx);
    await service.complete({ appointmentId: mine.id, expectedVersion: 2 }, ctx);

    const r = await service.getPublicPositionByPlate(mine.vehicle.plate, TEST_DATE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('COMPLETED');
      expect(r.value.aheadCount).toBe(0);
      expect(r.value.bayNumber).toBeNull();
    }
  });
});
