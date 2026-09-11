import { describe, expect, it } from 'vitest';
import { QueueService, type ActionContext } from '@/application/queue/QueueService';
import { LATE_GRACE_MINUTES } from '@/config/constants';
import { effectiveScheduleTime, isLate, type Appointment } from '@/domain/entities/appointment';
import { asOperatorId, asWorkstationId } from '@/domain/ids';
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
    correlationId: 'corr-ritardi',
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

// L'orologio dei test è fermo alle 08:00 UTC.
const ORA = '2026-09-10T08:00:00.000Z';
const AT = (hhmm: string) => `2026-09-10T${hhmm}:00.000Z` as Appointment['scheduledAt'];

describe('isLate', () => {
  it('in ritardo solo dopo la tolleranza, e solo se ancora in coda', () => {
    const attesa = makeAppointment({ scheduledAt: AT('07:00') });
    expect(isLate(attesa, ORA, LATE_GRACE_MINUTES)).toBe(true);

    // Entro la tolleranza resta nella coda normale.
    const pocoFa = makeAppointment({ scheduledAt: AT('07:55') });
    expect(isLate(pocoFa, ORA, LATE_GRACE_MINUTES)).toBe(false);

    // Appuntamento futuro.
    const dopo = makeAppointment({ scheduledAt: AT('09:00') });
    expect(isLate(dopo, ORA, LATE_GRACE_MINUTES)).toBe(false);
  });

  it('una pratica presa in carico o chiusa non è mai "in ritardo"', () => {
    for (const status of ['IN_PROGRESS', 'COMPLETED', 'NO_SHOW', 'CANCELLED'] as const) {
      const a = makeAppointment({ scheduledAt: AT('06:00'), status });
      expect(isLate(a, ORA, LATE_GRACE_MINUTES)).toBe(false);
    }
  });

  it('anche una pratica saltata può risultare in ritardo', () => {
    const saltata = makeAppointment({ scheduledAt: AT('06:30'), status: 'SKIPPED' });
    expect(isLate(saltata, ORA, LATE_GRACE_MINUTES)).toBe(true);
  });

  it("conta l'orario riprogrammato, non quello dell'agenda", () => {
    const rimessa = makeAppointment({
      scheduledAt: AT('06:00'),
      rescheduledAt: AT('08:30') as Appointment['rescheduledAt'],
    });
    expect(effectiveScheduleTime(rimessa)).toBe(AT('08:30'));
    expect(isLate(rimessa, ORA, LATE_GRACE_MINUTES)).toBe(false);
  });
});

describe('QueueService: gestione dei clienti in ritardo', () => {
  it('rescheduleToNow riporta in coda e sposta l’orario atteso ad adesso', async () => {
    const { env, service, ctx } = setup();
    const a = await insert(env, makeAppointment({ scheduledAt: AT('06:00') }));
    expect(isLate(a, ORA, LATE_GRACE_MINUTES)).toBe(true);

    const r = await service.rescheduleToNow({ appointmentId: a.id, expectedVersion: 1 }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('WAITING');
      expect(r.value.rescheduledAt).toBe(ORA);
      // L'orario dell'agenda resta intatto: è il dato di Infinity.
      expect(r.value.scheduledAt).toBe(AT('06:00'));
      expect(isLate(r.value, ORA, LATE_GRACE_MINUTES)).toBe(false);
    }
  });

  it('rimette in coda anche una pratica saltata', async () => {
    const { env, service, ctx } = setup();
    const a = await insert(env, makeAppointment({ scheduledAt: AT('06:00'), status: 'SKIPPED' }));
    const r = await service.rescheduleToNow({ appointmentId: a.id, expectedVersion: 1 }, ctx);
    expect(r.ok && r.value.status === 'WAITING' && r.value.skippedAt === null).toBe(true);
  });

  it('markNoShow chiude la pratica e deposita un evento per il CRM', async () => {
    const { env, service, ctx } = setup();
    const a = await insert(env, makeAppointment({ scheduledAt: AT('06:00') }));

    const r = await service.markNoShow(
      { appointmentId: a.id, expectedVersion: 1, reason: 'Non si è presentato' },
      ctx,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('NO_SHOW');
      expect(r.value.noShowAt).toBe(ORA);
    }

    const eventi = await env.crmOutbox.listByStatus(['PENDING']);
    expect(eventi).toHaveLength(1);
    expect(eventi[0]?.type).toBe('NO_SHOW');
    expect(eventi[0]?.appointmentId).toBe(a.id);
    expect(eventi[0]?.payload['code']).toBe(a.code);
    expect(eventi[0]?.payload['reason']).toBe('Non si è presentato');
  });

  it('segnare due volte lo stesso no-show non duplica l’evento per il CRM', async () => {
    const { env, service, ctx } = setup();
    const a = await insert(env, makeAppointment());
    await service.markNoShow({ appointmentId: a.id, expectedVersion: 1 }, ctx);
    // Il secondo tentativo è rifiutato dalla state machine (NO_SHOW non torna a NO_SHOW).
    const secondo = await service.markNoShow({ appointmentId: a.id, expectedVersion: 2 }, ctx);
    expect(secondo.ok).toBe(false);
    expect(await env.crmOutbox.listByStatus(['PENDING'])).toHaveLength(1);
  });

  it('una pratica in lavorazione non può essere segnata assente', async () => {
    const { env, service, ctx } = setup();
    const a = await insert(env, makeAppointment());
    await service.takeInCharge({ appointmentId: a.id, expectedVersion: 1, bayId: null }, ctx);

    const r = await service.markNoShow({ appointmentId: a.id, expectedVersion: 2 }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('INVALID_TRANSITION');
    }
    expect(await env.crmOutbox.listByStatus(['PENDING'])).toHaveLength(0);
  });

  it('il no-show resta visibile nella coda della giornata', async () => {
    const { env, service, ctx } = setup();
    const a = await insert(env, makeAppointment());
    await service.markNoShow({ appointmentId: a.id, expectedVersion: 1 }, ctx);

    const rows = await service.getQueue({
      businessDate: TEST_DATE,
      deskId: null,
      globalView: true,
    });
    expect(rows.find((r) => r.appointment.id === a.id)?.appointment.status).toBe('NO_SHOW');
  });
});
