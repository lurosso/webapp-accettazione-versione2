import { describe, expect, it } from 'vitest';
import { QueueService, type ActionContext } from '@/application/queue/QueueService';
import type { Appointment } from '@/domain/entities/appointment';
import { asBrandId, asDeskId, asOperatorId, asWorkstationId } from '@/domain/ids';
import { buildTestEnv, makeAppointment, TEST_DATE } from '../helpers/fixtures';

function setup() {
  const env = buildTestEnv();
  const service = new QueueService({
    appointments: env.appointments,
    referenceData: env.referenceData,
    operators: env.operators,
    notifications: env.notifications,
    crmOutbox: env.crmOutbox,
    eventBus: env.eventBus,
    clock: env.clock,
    ids: env.ids,
    logger: env.logger,
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

/** Pratica di uno sportello diverso (Jeep su S2), per verificare che non entri nel conteggio. */
const ALTRO_SPORTELLO = {
  deskId: asDeskId('desk-s2'),
  brandId: asBrandId('brand-jeep'),
} as const;

describe('QueueService.getPublicPositionByPlate', () => {
  it('conta solo i clienti dello stesso sportello e non espone dati personali', async () => {
    const { env, service } = setup();
    // Due davanti sullo stesso sportello (una saltata: conta comunque come in attesa).
    await insert(env, makeAppointment({ scheduledAt: AT('07:00') }));
    await insert(env, makeAppointment({ scheduledAt: AT('07:15'), status: 'SKIPPED' }));
    // Tre su un altro sportello: non devono far crescere l'attesa di questo cliente.
    await insert(env, makeAppointment({ ...ALTRO_SPORTELLO, scheduledAt: AT('06:30') }));
    await insert(env, makeAppointment({ ...ALTRO_SPORTELLO, scheduledAt: AT('06:45') }));
    await insert(env, makeAppointment({ ...ALTRO_SPORTELLO, scheduledAt: AT('07:10') }));
    const mine = await insert(env, makeAppointment({ scheduledAt: AT('07:30') }));
    // Una dopo: non conta.
    await insert(env, makeAppointment({ scheduledAt: AT('08:00') }));

    const r = await service.getPublicPositionByPlate(mine.vehicle.plate, TEST_DATE);
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.value.aheadCount).toBe(2);
    expect(r.value.code).toBe(mine.code);
    expect(r.value.status).toBe('WAITING');
    expect(r.value.bayNumber).toBeNull();
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

  it("lo sportello è dedotto dal marchio quando l'agenda non lo indica", async () => {
    const { env, service } = setup();
    // Nessun deskId: Lancia è servita dallo sportello S1, come la pratica cercata.
    await insert(
      env,
      makeAppointment({
        deskId: null,
        brandId: asBrandId('brand-lancia'),
        scheduledAt: AT('07:00'),
      }),
    );
    // Nessun deskId ma marchio di un altro sportello: fuori dal conteggio.
    await insert(
      env,
      makeAppointment({ deskId: null, brandId: asBrandId('brand-opel'), scheduledAt: AT('07:05') }),
    );
    const mine = await insert(env, makeAppointment({ scheduledAt: AT('07:30') }));

    const r = await service.getPublicPositionByPlate(mine.vehicle.plate, TEST_DATE);
    expect(r.ok && r.value.aheadCount).toBe(1);
  });

  it('un cliente rimesso in coda dopo un ritardo non risulta più davanti a chi era puntuale', async () => {
    const { env, service, ctx } = setup();
    const ritardatario = await insert(env, makeAppointment({ scheduledAt: AT('07:00') }));
    const mine = await insert(env, makeAppointment({ scheduledAt: AT('07:30') }));

    // Prima del rinvio il ritardatario è davanti.
    const prima = await service.getPublicPositionByPlate(mine.vehicle.plate, TEST_DATE);
    expect(prima.ok && prima.value.aheadCount).toBe(1);

    // L'accettatore lo rimette in coda: il suo orario effettivo diventa adesso (08:00 del clock).
    const rinviato = await service.rescheduleToNow(
      { appointmentId: ritardatario.id, expectedVersion: 1 },
      ctx,
    );
    expect(rinviato.ok).toBe(true);

    const dopo = await service.getPublicPositionByPlate(mine.vehicle.plate, TEST_DATE);
    expect(dopo.ok && dopo.value.aheadCount).toBe(0);
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

  it('normalizza la targa digitata dal cliente (minuscole, spazi, trattini)', async () => {
    const { env, service } = setup();
    const mine = await insert(env, makeAppointment());
    const plate = mine.vehicle.plate;
    const digitata = `${plate.slice(0, 2).toLowerCase()} ${plate.slice(2, 5)}-${plate.slice(5).toLowerCase()}`;
    const r = await service.getPublicPositionByPlate(digitata, TEST_DATE);
    expect(r.ok && r.value.code === mine.code).toBe(true);
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
