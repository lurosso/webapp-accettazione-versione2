import { describe, expect, it } from 'vitest';
import { QueueService, type ActionContext } from '@/application/queue/QueueService';
import {
  compareQueueOrder,
  isDueWithinGrace,
  isLate,
  type Appointment,
} from '@/domain/entities/appointment';
import { asOperatorId, asWorkstationId } from '@/domain/ids';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import { buildTestEnv, makeAppointment, TestClock } from '../helpers/fixtures';

const AT = (hhmm: string): IsoDateTime => `2026-09-10T${hhmm}:00.000Z` as IsoDateTime;

function setup(nowIso = '2026-09-10T08:40:00.000Z') {
  const clock = new TestClock(nowIso);
  const env = buildTestEnv(clock);
  const queue = new QueueService({
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
  const ctx: ActionContext = {
    operatorId: asOperatorId('op-advisor-1'),
    workstationId: asWorkstationId('ws-p1'),
    correlationId: 'corr-react',
  };
  return { env, clock, queue, ctx };
}

async function insert(env: ReturnType<typeof buildTestEnv>, a: Appointment): Promise<Appointment> {
  const r = await env.appointments.insert(a);
  if (!r.ok) {
    throw new Error(r.error.message);
  }
  return r.value;
}

describe('Ritardo entro la tolleranza (riga gialla)', () => {
  it('è "da servire ora" fra l\'orario atteso e i dieci minuti successivi, poi diventa in ritardo', () => {
    const a = makeAppointment({ scheduledAt: AT('08:30') });
    expect(isDueWithinGrace(a, AT('08:29'), 10)).toBe(false);
    expect(isDueWithinGrace(a, AT('08:30'), 10)).toBe(true);
    expect(isDueWithinGrace(a, AT('08:39'), 10)).toBe(true);
    expect(isLate(a, AT('08:39'), 10)).toBe(false);
    expect(isDueWithinGrace(a, AT('08:41'), 10)).toBe(false);
    expect(isLate(a, AT('08:41'), 10)).toBe(true);
    // Solo chi è in coda: una pratica in carico non è "da servire".
    expect(isDueWithinGrace({ ...a, status: 'IN_PROGRESS' }, AT('08:35'), 10)).toBe(false);
  });
});

describe('Riattivazione di un cliente segnato assente', () => {
  it('torna in attesa con l\'orario di adesso; il "segnato assente" resta nella cronologia', async () => {
    const { env, queue, ctx, clock } = setup();
    const assente = await insert(
      env,
      makeAppointment({ scheduledAt: AT('07:45'), status: 'NO_SHOW', noShowAt: AT('08:00') }),
    );
    const r = await queue.reactivate({ appointmentId: assente.id, expectedVersion: 1 }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.value.status).toBe('WAITING');
    expect(r.value.rescheduledAt).toBe(clock.nowIso());
    expect(r.value.scheduledAt).toBe(AT('07:45'));
    expect(r.value.noShowAt).toBe(AT('08:00'));
    expect(r.value.code).toBe(assente.code);
    // Appena riattivato non è in ritardo: l'orario atteso è adesso.
    expect(isLate(r.value, clock.nowIso(), 10)).toBe(false);
  });

  it('si riattiva solo chi è assente', async () => {
    const { env, queue, ctx } = setup();
    const inCoda = await insert(env, makeAppointment());
    const r = await queue.reactivate({ appointmentId: inCoda.id, expectedVersion: 1 }, ctx);
    expect(!r.ok && r.error.code).toBe('INVALID_TRANSITION');
  });

  it('chiude il lead del BDC: il cliente è arrivato, nessuno deve richiamarlo', async () => {
    const { env, queue, ctx } = setup();
    const a = await insert(env, makeAppointment({ scheduledAt: AT('07:45') }));
    const assente = await queue.markNoShow({ appointmentId: a.id, expectedVersion: 1 }, ctx);
    if (!assente.ok) {
      throw new Error('no-show fallito');
    }
    const lead = (await env.crmOutbox.listByStatus(['PENDING', 'SENT', 'FAILED'])).find(
      (e) => e.appointmentId === a.id && e.type === 'NO_SHOW',
    );
    expect(lead).toBeDefined();

    const r = await queue.reactivate(
      { appointmentId: a.id, expectedVersion: assente.value.version },
      ctx,
    );
    expect(r.ok).toBe(true);
    const chiuso = await env.crmOutbox.findById(lead!.id);
    expect(chiuso?.status).toBe('MANUAL');
    expect(chiuso?.handledByOperatorId).toBe(ctx.operatorId);
    expect(chiuso?.handledNote).toContain('arrivato in ritardo');
    expect(chiuso?.nextAttemptAt).toBeNull();
  });
});

describe('Regola di coda del ritardatario riattivato', () => {
  it('viene servito dopo i puntuali già presenti e prima di chi non è ancora arrivato; il codice non cambia', async () => {
    const { env, queue, ctx, clock } = setup('2026-09-10T08:40:00.000Z');
    const A = await insert(env, makeAppointment({ scheduledAt: AT('08:00'), sequence: 1 }));
    const B = await insert(env, makeAppointment({ scheduledAt: AT('08:30'), sequence: 2 }));
    const C = await insert(env, makeAppointment({ scheduledAt: AT('09:00'), sequence: 3 }));
    const D = await insert(
      env,
      makeAppointment({
        scheduledAt: AT('07:45'),
        sequence: 0,
        status: 'NO_SHOW',
        noShowAt: AT('08:00'),
      }),
    );
    // Prima della riattivazione D, con il suo orario delle 7:45, sarebbe il primo della fila.
    expect([...[A, B, C, D]].sort(compareQueueOrder).map((x) => x.code)).toEqual([
      D.code,
      A.code,
      B.code,
      C.code,
    ]);

    const r = await queue.reactivate({ appointmentId: D.id, expectedVersion: 1 }, ctx);
    if (!r.ok) {
      throw new Error('riattivazione fallita');
    }
    const inCoda = await env.appointments.listByDate(D.businessDate, {
      statuses: ['WAITING', 'SKIPPED'],
    });
    const ordine = [...inCoda].sort(compareQueueOrder).map((x) => x.code);
    expect(ordine).toEqual([A.code, B.code, D.code, C.code]);
    expect(r.value.code).toBe(D.code);

    // Per il portale del cliente D ha davanti i due puntuali dello stesso sportello.
    const posizione = await queue.getPublicPositionByPlate(D.vehicle.plate, D.businessDate);
    expect(posizione.ok && posizione.value.aheadCount).toBe(2);
    // E chi arriva alle 9:00 vede D davanti a sé.
    const posizioneC = await queue.getPublicPositionByPlate(C.vehicle.plate, C.businessDate);
    expect(posizioneC.ok && posizioneC.value.aheadCount).toBe(3);
    expect(clock.nowIso()).toBe(r.value.rescheduledAt);
  });
});
