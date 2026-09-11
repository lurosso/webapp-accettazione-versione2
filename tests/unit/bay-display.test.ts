import { describe, expect, it } from 'vitest';
import { QueueService, type ActionContext } from '@/application/queue/QueueService';
import { RELEASING_DISPLAY_MS } from '@/config/constants';
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
    correlationId: 'corr-display',
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

describe('QueueService.getBayDisplay', () => {
  it('campata libera quando nessuna pratica è in lavorazione', async () => {
    const { service } = setup();
    const r = await service.getBayDisplay('1', TEST_DATE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.state).toBe('FREE');
      expect(r.value.bayCode).toBe('C1');
      expect(r.value.bayNumber).toBe(1);
      expect(r.value.currentCode).toBeNull();
      expect(r.value.currentPlate).toBeNull();
    }
  });

  it('in servizio: codice e targa della pratica presa in carico su quella campata', async () => {
    const { env, service, ctx } = setup();
    const a = await insert(env, makeAppointment());
    await service.takeInCharge(
      { appointmentId: a.id, expectedVersion: a.version, bayId: asBayId('bay-c1') },
      ctx,
    );

    const r = await service.getBayDisplay('C1', TEST_DATE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.state).toBe('SERVING');
      expect(r.value.currentCode).toBe(a.code);
      expect(r.value.currentPlate).toBe(a.vehicle.plate);
      expect(r.value.since).not.toBeNull();
    }

    // Le altre campate restano libere: il monitor è per campata, non per officina.
    const other = await service.getBayDisplay('2', TEST_DATE);
    expect(other.ok && other.value.state).toBe('FREE');
  });

  it('dopo "Completato" invita ad avanzare, poi torna libera passato il tempo di rilascio', async () => {
    const { env, service, ctx } = setup();
    const a = await insert(env, makeAppointment());
    await service.takeInCharge(
      { appointmentId: a.id, expectedVersion: 1, bayId: asBayId('bay-c1') },
      ctx,
    );
    await service.complete({ appointmentId: a.id, expectedVersion: 2 }, ctx);

    const justCompleted = await service.getBayDisplay('1', TEST_DATE);
    expect(justCompleted.ok).toBe(true);
    if (justCompleted.ok) {
      expect(justCompleted.value.state).toBe('RELEASING');
      expect(justCompleted.value.lastCompletedCode).toBe(a.code);
      expect(justCompleted.value.currentCode).toBeNull();
    }

    env.clock.advance(RELEASING_DISPLAY_MS + 1_000);
    const later = await service.getBayDisplay('1', TEST_DATE);
    expect(later.ok && later.value.state).toBe('FREE');
  });

  it("campata sconosciuta → NOT_FOUND con l'elenco di quelle attive", async () => {
    const { service } = setup();
    const r = await service.getBayDisplay('99', TEST_DATE);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('NOT_FOUND');
      expect(r.error.details?.['campateAttive']).toEqual(['C1', 'C2', 'C3', 'C4']);
    }
  });

  it('rilasciando la pratica la campata torna subito libera, senza invito ad avanzare', async () => {
    const { env, service, ctx } = setup();
    const a = await insert(env, makeAppointment());
    await service.takeInCharge(
      { appointmentId: a.id, expectedVersion: 1, bayId: asBayId('bay-c1') },
      ctx,
    );
    await service.release({ appointmentId: a.id, expectedVersion: 2 }, ctx);

    const r = await service.getBayDisplay('1', TEST_DATE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.state).toBe('FREE');
      expect(r.value.lastCompletedCode).toBeNull();
    }
  });
});
