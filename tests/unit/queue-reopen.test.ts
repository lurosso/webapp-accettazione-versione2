import { describe, expect, it } from 'vitest';
import { InspectionService } from '@/application/media/InspectionService';
import { QueueService, type ActionContext } from '@/application/queue/QueueService';
import type { Appointment } from '@/domain/entities/appointment';
import { isAutoClosedPending } from '@/domain/entities/appointment';
import { asOperatorId, asWorkstationId } from '@/domain/ids';
import { buildTestEnv, makeAppointment, TEST_DATE } from '../helpers/fixtures';

function setup() {
  const env = buildTestEnv();
  const queue = new QueueService({
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
  const inspection = new InspectionService({
    appointments: env.appointments,
    media: env.media,
    mediaStorage: env.mediaStorage,
    queueService: queue,
    crmNotifier: env.crmNotifier,
    clock: env.clock,
    ids: env.ids,
    logger: env.logger,
    retentionDays: 30,
  });
  const mario: ActionContext = {
    operatorId: asOperatorId('op-advisor-1'),
    workstationId: asWorkstationId('ws-p1'),
    correlationId: 'corr-reopen',
  };
  const laura: ActionContext = {
    operatorId: asOperatorId('op-advisor-2'),
    workstationId: asWorkstationId('ws-p3'),
    correlationId: 'corr-reopen-2',
  };
  return { env, queue, inspection, mario, laura };
}

async function insert(env: ReturnType<typeof buildTestEnv>, a: Appointment): Promise<Appointment> {
  const r = await env.appointments.insert(a);
  if (!r.ok) {
    throw new Error(r.error.message);
  }
  return r.value;
}

async function completata(
  env: ReturnType<typeof buildTestEnv>,
  queue: QueueService,
  ctx: ActionContext,
): Promise<Appointment> {
  const a = await insert(env, makeAppointment());
  const presa = await queue.takeInCharge(
    { appointmentId: a.id, expectedVersion: 1, bayId: null },
    ctx,
  );
  if (!presa.ok) {
    throw new Error(presa.error.message);
  }
  const chiusa = await queue.complete(
    { appointmentId: a.id, expectedVersion: presa.value.version },
    ctx,
  );
  if (!chiusa.ok) {
    throw new Error(chiusa.error.message);
  }
  return chiusa.value;
}

describe('QueueService.reopenCompleted: "Completato" premuto per errore', () => {
  it('riporta la pratica in carico a chi la riapre, con una campata libera', async () => {
    const { env, queue, mario, laura } = setup();
    const chiusa = await completata(env, queue, mario);
    expect(chiusa.completedAt).not.toBeNull();

    env.clock.advance(60_000);
    const r = await queue.reopenCompleted(
      { appointmentId: chiusa.id, expectedVersion: chiusa.version },
      laura,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.value.status).toBe('IN_PROGRESS');
    expect(r.value.operatorId).toBe(laura.operatorId);
    expect(r.value.completedAt).toBeNull();
    // Laura lavora all'Accettazione 3: la sua campata predefinita è libera e le viene assegnata.
    expect(r.value.bayId).toBe('bay-c3');
    // La presa in carico originale resta scritta: la pratica non "ricomincia".
    expect(r.value.takenAt).toBe(chiusa.takenAt);
  });

  it('si può riaprire solo una pratica completata', async () => {
    const { env, queue, mario } = setup();
    const inCoda = await insert(env, makeAppointment());
    const r = await queue.reopenCompleted({ appointmentId: inCoda.id, expectedVersion: 1 }, mario);
    expect(!r.ok && r.error.code).toBe('INVALID_TRANSITION');
  });

  it('dopo la riapertura la pratica si completa di nuovo e il CRM riceve un secondo check-in', async () => {
    const { env, queue, inspection, mario } = setup();
    const chiusa = await completata(env, queue, mario);
    const riaperta = await queue.reopenCompleted(
      { appointmentId: chiusa.id, expectedVersion: chiusa.version },
      mario,
    );
    if (!riaperta.ok) {
      throw new Error('riapertura fallita');
    }
    env.clock.advance(5 * 60_000);
    // Il video è obbligatorio anche al secondo giro: la riapertura non salta il requisito.
    const video = await inspection.addMedia({
      appointmentId: chiusa.id,
      operatorId: mario.operatorId,
      bytes: new Uint8Array(4096).fill(3),
      mimeType: 'video/mp4',
      category: null,
    });
    expect(video.ok).toBe(true);
    const secondo = await inspection.completeCheckIn(
      {
        appointmentId: chiusa.id,
        expectedVersion: riaperta.value.version,
        inspectionNotes: 'Foto rifatte dopo la riapertura',
      },
      mario,
    );
    expect(secondo.ok).toBe(true);
    // Due completamenti, due eventi distinti verso il CRM: la chiave tiene conto dell'orario.
    const checkIn = env.crm.received.filter((r) => r.idempotencyKey.includes(':CHECK_IN:'));
    expect(checkIn).toHaveLength(1);
    const outbox = await env.crmOutbox.listByStatus(['SENT', 'PENDING', 'FAILED', 'MANUAL']);
    expect(outbox.filter((e) => e.type === 'CHECK_IN')).toHaveLength(1);
  });
});

describe('Chiusura di giornata: pratiche ancora in carico', () => {
  it("le chiude d'ufficio come completate da confermare, senza avvisare il CRM", async () => {
    const { env, queue, mario } = setup();
    const a = await insert(env, makeAppointment());
    await queue.takeInCharge({ appointmentId: a.id, expectedVersion: 1, bayId: null }, mario);

    const r = await queue.closeBusinessDay(TEST_DATE, {
      operatorId: asOperatorId('system'),
      workstationId: null,
      correlationId: 'corr-close',
      actorKind: 'SYSTEM',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.value.autoClosed).toEqual([a.code]);
    const salvata = await env.appointments.findById(a.id);
    expect(salvata?.status).toBe('COMPLETED');
    expect(salvata?.completedAt).toBe(env.clock.nowIso());
    expect(salvata?.autoClosedAt).toBe(env.clock.nowIso());
    expect(salvata?.autoCloseConfirmedAt).toBeNull();
    expect(salvata !== null && isAutoClosedPending(salvata)).toBe(true);
    expect(env.crm.received.filter((e) => e.idempotencyKey.includes(':CHECK_IN:'))).toHaveLength(0);
  });

  it('il responsabile conferma la chiusura: il flag si spegne e il CRM riceve il check-in', async () => {
    const { env, queue, inspection, mario } = setup();
    const a = await insert(env, makeAppointment());
    await queue.takeInCharge({ appointmentId: a.id, expectedVersion: 1, bayId: null }, mario);
    await queue.closeBusinessDay(TEST_DATE, {
      operatorId: asOperatorId('system'),
      workstationId: null,
      correlationId: 'corr-close',
      actorKind: 'SYSTEM',
    });
    const chiusa = await env.appointments.findById(a.id);
    if (chiusa === null) {
      throw new Error('fixture');
    }

    const r = await inspection.confirmAutoClosed(
      { appointmentId: a.id, expectedVersion: chiusa.version },
      { operatorId: asOperatorId('op-supervisor'), workstationId: null, correlationId: 'c' },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.value.appointment.status).toBe('COMPLETED');
    expect(r.value.appointment.autoCloseConfirmedAt).toBe(env.clock.nowIso());
    expect(isAutoClosedPending(r.value.appointment)).toBe(false);
    expect(env.crm.received.filter((e) => e.idempotencyKey.includes(':CHECK_IN:'))).toHaveLength(1);

    // Confermare due volte non ha senso.
    const doppia = await inspection.confirmAutoClosed(
      { appointmentId: a.id, expectedVersion: r.value.appointment.version },
      { operatorId: asOperatorId('op-supervisor'), workstationId: null, correlationId: 'c' },
    );
    expect(!doppia.ok && doppia.error.code).toBe('VALIDATION');
  });

  it("riaprire una pratica chiusa d'ufficio cancella il flag e la rimette in carico", async () => {
    const { env, queue, mario } = setup();
    const a = await insert(env, makeAppointment());
    await queue.takeInCharge({ appointmentId: a.id, expectedVersion: 1, bayId: null }, mario);
    await queue.closeBusinessDay(TEST_DATE, {
      operatorId: asOperatorId('system'),
      workstationId: null,
      correlationId: 'corr-close',
      actorKind: 'SYSTEM',
    });
    const chiusa = await env.appointments.findById(a.id);
    const r = await queue.reopenCompleted(
      { appointmentId: a.id, expectedVersion: chiusa?.version ?? 0 },
      mario,
    );
    expect(r.ok && r.value.status).toBe('IN_PROGRESS');
    expect(r.ok && r.value.autoClosedAt).toBeNull();
    expect(r.ok && isAutoClosedPending(r.value)).toBe(false);
  });
});
