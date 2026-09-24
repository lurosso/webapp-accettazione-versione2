import { describe, expect, it } from 'vitest';
import { BdcLeadService } from '@/application/crm/BdcLeadService';
import { QueueService, type ActionContext } from '@/application/queue/QueueService';
import { asOperatorId, asWorkstationId } from '@/domain/ids';
import type { Appointment } from '@/domain/entities/appointment';
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
  const bdc = new BdcLeadService({
    outbox: env.crmOutbox,
    appointments: env.appointments,
    referenceData: env.referenceData,
    operators: env.operators,
    clock: env.clock,
    logger: env.logger,
  });
  const ctx: ActionContext = {
    operatorId: asOperatorId('op-advisor-1'),
    workstationId: asWorkstationId('ws-p1'),
    correlationId: 'corr-bdc',
  };
  return { env, queueService, bdc, ctx };
}

async function insert(env: ReturnType<typeof buildTestEnv>, a: Appointment): Promise<Appointment> {
  const r = await env.appointments.insert(a);
  if (!r.ok) {
    throw new Error(r.error.message);
  }
  return r.value;
}

describe('Assenti come lead al CRM del BDC', () => {
  it('ogni assente parte da solo verso il CRM, senza che nessuno lo inoltri', async () => {
    const { env, queueService, ctx } = setup();
    const a = await insert(env, makeAppointment());
    await queueService.markNoShow(
      { appointmentId: a.id, expectedVersion: 1, reason: 'Non si è presentato' },
      ctx,
    );
    expect(env.crm.received).toHaveLength(1);
    expect(env.crm.received[0]).toMatchObject({ code: a.code });
  });
});

describe('BdcLeadService: assenti e anomalie della giornata (vista amministratore)', () => {
  it('un cliente segnato assente diventa un lead con i dati per telefonargli', async () => {
    const { env, queueService, bdc, ctx } = setup();
    const a = await insert(env, makeAppointment());
    await queueService.markNoShow(
      { appointmentId: a.id, expectedVersion: 1, reason: 'Non si è presentato' },
      ctx,
    );

    const view = await bdc.listLeads({ businessDate: TEST_DATE });
    expect(view.openCount).toBe(1);
    expect(view.handledCount).toBe(0);
    const lead = view.leads[0];
    expect(lead?.code).toBe(a.code);
    expect(lead?.customerName).toContain('Rossi');
    expect(lead?.phone).toBe(a.customer.phone);
    expect(lead?.plate).toBe(a.vehicle.plate);
    expect(lead?.vehicle).toContain('500');
    expect(lead?.reason).toBe('Non si è presentato');
    expect(lead?.handled).toBe(false);
    // Con il CRM raggiungibile l'evento risulta già inviato, ma il lead resta da lavorare.
    expect(lead?.deliveryStatus).toBe('SENT');
  });

  it('una pratica completata non genera lead', async () => {
    const { env, queueService, bdc, ctx } = setup();
    const a = await insert(env, makeAppointment());
    await queueService.takeInCharge({ appointmentId: a.id, expectedVersion: 1, bayId: null }, ctx);
    await queueService.complete({ appointmentId: a.id, expectedVersion: 2 }, ctx);

    const view = await bdc.listLeads({ businessDate: TEST_DATE });
    expect(view.leads).toHaveLength(0);
  });

  it('il filtro per giornata esclude le assenze di altri giorni', async () => {
    const { env, queueService, bdc, ctx } = setup();
    const a = await insert(env, makeAppointment());
    await queueService.markNoShow({ appointmentId: a.id, expectedVersion: 1 }, ctx);

    expect((await bdc.listLeads({ businessDate: '2026-09-09' })).leads).toHaveLength(0);
    // Senza giornata si vedono tutte quelle ancora in memoria.
    expect((await bdc.listLeads({ businessDate: null })).leads).toHaveLength(1);
  });

  it('con il CRM guasto l’assente resta in coda di uscita e l’amministratore lo vede', async () => {
    const env = buildTestEnv();
    const { CrmServiceMock } = await import('@/services/mocks/CrmServiceMock');
    const { CrmNotifier } = await import('@/application/crm/CrmNotifier');
    const notifier = new CrmNotifier({
      crm: new CrmServiceMock(
        { mode: 'error', latencyMs: 0 },
        { clock: env.clock, logger: env.logger },
      ),
      outbox: env.crmOutbox,
      referenceData: env.referenceData,
      clock: env.clock,
      ids: env.ids,
      logger: env.logger,
    });
    const queueService = new QueueService({
      appointments: env.appointments,
      referenceData: env.referenceData,
      operators: env.operators,
      notifications: env.notifications,
      crmNotifier: notifier,
      eventBus: env.eventBus,
      clock: env.clock,
      ids: env.ids,
      logger: env.logger,
    });
    const bdc = new BdcLeadService({
      outbox: env.crmOutbox,
      appointments: env.appointments,
      referenceData: env.referenceData,
      operators: env.operators,
      clock: env.clock,
      logger: env.logger,
    });
    const ctx: ActionContext = {
      operatorId: asOperatorId('op-advisor-1'),
      workstationId: asWorkstationId('ws-p1'),
      correlationId: 'corr-bdc-crm-giu',
    };

    const a = await insert(env, makeAppointment());
    await queueService.markNoShow({ appointmentId: a.id, expectedVersion: 1 }, ctx);

    const view = await bdc.listLeads({ businessDate: TEST_DATE });
    // Il finto CRM rifiuta con un errore definitivo: la consegna è abbandonata, non in attesa.
    // Resta visibile (e rinviabile dal pannello Sistema dell'amministratore).
    expect(view.leads[0]?.deliveryStatus).toBe('FAILED');
    expect(view.leads[0]?.handled).toBe(false);
  });
});
