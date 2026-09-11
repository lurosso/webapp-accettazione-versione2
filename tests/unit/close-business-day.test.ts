import { describe, expect, it } from 'vitest';
import { QueueService, type ActionContext } from '@/application/queue/QueueService';
import { BdcLeadService } from '@/application/crm/BdcLeadService';
import type { Appointment } from '@/domain/entities/appointment';
import { asOperatorId, asWorkstationId } from '@/domain/ids';
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
    operatorId: asOperatorId('op-supervisor'),
    workstationId: asWorkstationId('ws-p1'),
    correlationId: 'corr-chiusura',
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

describe('QueueService: chiusura della giornata', () => {
  it('chi era in coda diventa assente, chi era in carico viene annullato', async () => {
    const { env, service, ctx } = setup();
    const inAttesa = await insert(env, makeAppointment());
    const saltata = await insert(env, makeAppointment({ status: 'SKIPPED', skipCount: 1 }));
    const inCarico = await insert(env, makeAppointment());
    await service.takeInCharge(
      { appointmentId: inCarico.id, expectedVersion: 1, bayId: null },
      ctx,
    );

    const r = await service.closeBusinessDay(TEST_DATE, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.value.noShow).toEqual(expect.arrayContaining([inAttesa.code, saltata.code]));
    expect(r.value.cancelled).toEqual([inCarico.code]);
    expect(r.value.failed).toEqual([]);

    expect((await env.appointments.findById(inAttesa.id))?.status).toBe('NO_SHOW');
    expect((await env.appointments.findById(saltata.id))?.status).toBe('NO_SHOW');
    expect((await env.appointments.findById(inCarico.id))?.status).toBe('CANCELLED');
  });

  it('le pratiche già chiuse non vengono toccate', async () => {
    const { env, service, ctx } = setup();
    const completata = await insert(env, makeAppointment());
    await service.takeInCharge(
      { appointmentId: completata.id, expectedVersion: 1, bayId: null },
      ctx,
    );
    await service.complete({ appointmentId: completata.id, expectedVersion: 2 }, ctx);
    const primaDella = await env.appointments.findById(completata.id);

    const r = await service.closeBusinessDay(TEST_DATE, ctx);
    expect(r.ok && r.value.alreadyClosed).toBe(1);

    const dopo = await env.appointments.findById(completata.id);
    expect(dopo?.status).toBe('COMPLETED');
    expect(dopo?.version).toBe(primaDella?.version);
  });

  it('gli assenti della chiusura diventano lead per il BDC, con evento al CRM', async () => {
    const { env, service, ctx } = setup();
    const a = await insert(env, makeAppointment());

    await service.closeBusinessDay(TEST_DATE, ctx);

    const bdc = new BdcLeadService({
      outbox: env.crmOutbox,
      appointments: env.appointments,
      referenceData: env.referenceData,
      operators: env.operators,
      clock: env.clock,
      logger: env.logger,
    });
    const view = await bdc.listLeads({ businessDate: TEST_DATE });
    expect(view.openCount).toBe(1);
    expect(view.leads[0]?.code).toBe(a.code);
    expect(view.leads[0]?.reason).toContain('Chiusura giornata');
    expect(env.crm.received).toHaveLength(1);
  });

  it('monitor e tabellone restano vuoti: nessun codice chiamato, accettazioni libere', async () => {
    const { env, service, ctx } = setup();
    const a = await insert(env, makeAppointment());
    await service.takeInCharge({ appointmentId: a.id, expectedVersion: 1, bayId: null }, ctx);

    const primaDella = await service.getBayDisplay('1', TEST_DATE);
    expect(primaDella.ok && primaDella.value.state).toBe('SERVING');

    await service.closeBusinessDay(TEST_DATE, ctx);

    const dopo = await service.getBayDisplay('1', TEST_DATE);
    expect(dopo.ok && dopo.value.state).toBe('FREE');
    expect(dopo.ok && dopo.value.currentCode).toBeNull();

    const tabellone = await service.getWaitingBoard(TEST_DATE, 5);
    expect(tabellone.serving).toHaveLength(0);
    expect(tabellone.next).toHaveLength(0);
    expect(tabellone.waitingCount).toBe(0);
  });

  it("pubblica l'evento di giornata chiusa con i conteggi", async () => {
    const { env, service, ctx } = setup();
    await insert(env, makeAppointment());
    await insert(env, makeAppointment());

    await service.closeBusinessDay(TEST_DATE, ctx);

    const eventi = env.eventBus.listSince(0).filter((e) => e.type === 'BUSINESS_DAY_CLOSED');
    expect(eventi).toHaveLength(1);
    expect(eventi[0]).toMatchObject({ businessDate: TEST_DATE, noShowCount: 2, cancelledCount: 0 });
  });

  it('una giornata senza pratiche si chiude senza errori', async () => {
    const { service, ctx } = setup();
    const r = await service.closeBusinessDay(TEST_DATE, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.noShow).toEqual([]);
      expect(r.value.cancelled).toEqual([]);
      expect(r.value.alreadyClosed).toBe(0);
    }
  });

  it('ripetere la chiusura non cambia nulla: le pratiche sono già chiuse', async () => {
    const { env, service, ctx } = setup();
    await insert(env, makeAppointment());

    const prima = await service.closeBusinessDay(TEST_DATE, ctx);
    const seconda = await service.closeBusinessDay(TEST_DATE, ctx);
    expect(prima.ok && prima.value.noShow).toHaveLength(1);
    expect(seconda.ok && seconda.value.noShow).toHaveLength(0);
    expect(seconda.ok && seconda.value.alreadyClosed).toBe(1);
    // Nessun doppione verso il CRM: la chiave di idempotenza è la stessa.
    expect(env.crm.received).toHaveLength(1);
  });
});
