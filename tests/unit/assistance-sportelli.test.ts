// Gli sportelli visti dall'amministratore: a chi sono assegnati e cosa ci sta succedendo.
import { describe, expect, it } from 'vitest';
import { AssistanceService } from '@/application/admin/AssistanceService';
import { QueueService, type ActionContext } from '@/application/queue/QueueService';
import { asBayId, asOperatorId, asWorkstationId } from '@/domain/ids';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import { buildTestEnv, makeAppointment, TEST_DATE } from '../helpers/fixtures';

function setup() {
  const env = buildTestEnv();
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
  const assistance = new AssistanceService({
    appointments: env.appointments,
    referenceData: env.referenceData,
    operators: env.operators,
    claims: env.workstationClaims,
    clock: env.clock,
  });
  const ctx: ActionContext = {
    operatorId: asOperatorId('op-advisor-1'),
    workstationId: asWorkstationId('ws-p1'),
    correlationId: 'corr-assistenza',
  };
  return { env, queueService, assistance, ctx };
}

describe('AssistanceService: i quattro sportelli per l’amministratore', () => {
  it('a officina ferma sono tutti liberi e senza nessuno collegato', async () => {
    const { assistance } = setup();
    const vista = await assistance.overview(TEST_DATE);

    expect(vista.bays.map((b) => b.code)).toEqual(['A', 'B', 'C', 'D']);
    for (const bay of vista.bays) {
      expect(bay.assignedOperatorName).toBeNull();
      expect(bay.occupiedBy).toBeNull();
      // L'area per marchio serve al monitoraggio: A e B stanno su FCA, C e D su PSA.
      expect(bay.deskCode).not.toBeNull();
      expect(bay.workstationId).not.toBeNull();
    }
    expect(vista.bays[0]?.deskCode).toBe('FCA');
    expect(vista.bays[3]?.deskCode).toBe('PSA');
  });

  it('dice chi è collegato anche quando lo sportello non ha pratiche in corso', async () => {
    const { env, assistance } = setup();
    await env.workstationClaims.upsert({
      workstationId: asWorkstationId('ws-p2'),
      operatorId: asOperatorId('op-advisor-1'),
      operatorName: 'Mario Rossi',
      claimedAt: env.clock.nowIso(),
      expiresAt: '2099-01-01T00:00:00.000Z' as IsoDateTime,
    });

    const sportelloB = (await assistance.overview(TEST_DATE)).bays.find((b) => b.code === 'B');
    expect(sportelloB?.assignedOperatorName).toBe('Mario Rossi');
    expect(sportelloB?.assignedSince).not.toBeNull();
    // Collegato ma fermo: è libero, aspetta il prossimo cliente.
    expect(sportelloB?.occupiedBy).toBeNull();
  });

  it('con una pratica in carico dice targa, codice e da quanto', async () => {
    const { env, queueService, assistance, ctx } = setup();
    const inserita = await env.appointments.insert(makeAppointment());
    if (!inserita.ok) {
      throw new Error('insert');
    }
    await queueService.takeInCharge(
      { appointmentId: inserita.value.id, expectedVersion: 1, bayId: asBayId('bay-c3') },
      ctx,
    );
    env.clock.advance(12 * 60_000);

    const sportelloC = (await assistance.overview(TEST_DATE)).bays.find((b) => b.code === 'C');
    expect(sportelloC?.occupiedBy?.code).toBe(inserita.value.code);
    expect(sportelloC?.occupiedBy?.plate).toBe(inserita.value.vehicle.plate);
    expect(sportelloC?.occupiedBy?.operatorName).toBe('Mario Rossi');
    expect(sportelloC?.occupiedBy?.minutesInProgress).toBe(12);
    // Nessuno è collegato a quella postazione: la pratica è lì, l'operatore no.
    expect(sportelloC?.assignedOperatorName).toBeNull();
  });
});
