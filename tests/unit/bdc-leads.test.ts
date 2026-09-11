import { describe, expect, it } from 'vitest';
import { BdcLeadService } from '@/application/crm/BdcLeadService';
import { QueueService, type ActionContext } from '@/application/queue/QueueService';
import { asOperatorId, asWorkstationId, type CrmOutboxEventId } from '@/domain/ids';
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

/** Operatore del BDC che chiude i lead (nel seed è un responsabile). */
const BDC = { operatorId: asOperatorId('op-supervisor') };

describe('BdcLeadService: lead da ricontattare', () => {
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

  it('"segna come ricontattato" chiude il lead con operatore, ora ed esito', async () => {
    const { env, queueService, bdc, ctx } = setup();
    const a = await insert(env, makeAppointment());
    await queueService.markNoShow({ appointmentId: a.id, expectedVersion: 1 }, ctx);
    const aperti = await bdc.listLeads({ businessDate: TEST_DATE });
    const eventId = aperti.leads[0]?.eventId as CrmOutboxEventId;

    const r = await bdc.markContacted({ eventId, note: 'Richiama lunedì mattina' }, BDC);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.handled).toBe(true);
      expect(r.value.handledByName).toBe('Giulia Ferrari');
      expect(r.value.handledNote).toBe('Richiama lunedì mattina');
      expect(r.value.handledAt).toBe(env.clock.nowIso());
    }

    // Sparisce dai lead aperti, ma resta consultabile con i già gestiti.
    expect((await bdc.listLeads({ businessDate: TEST_DATE })).leads).toHaveLength(0);
    const conChiusi = await bdc.listLeads({ businessDate: TEST_DATE, includeHandled: true });
    expect(conChiusi.leads).toHaveLength(1);
    expect(conChiusi.openCount).toBe(0);
    expect(conChiusi.handledCount).toBe(1);
  });

  it('chiudere due volte lo stesso lead non sovrascrive il primo ricontatto', async () => {
    const { env, queueService, bdc, ctx } = setup();
    const a = await insert(env, makeAppointment());
    await queueService.markNoShow({ appointmentId: a.id, expectedVersion: 1 }, ctx);
    const eventId = (await bdc.listLeads({ businessDate: TEST_DATE })).leads[0]
      ?.eventId as CrmOutboxEventId;

    await bdc.markContacted({ eventId, note: 'Primo tentativo andato a buon fine' }, BDC);
    const secondo = await bdc.markContacted(
      { eventId, note: 'Nota di un altro operatore' },
      { operatorId: asOperatorId('op-advisor-2') },
    );
    expect(secondo.ok).toBe(true);
    if (secondo.ok) {
      expect(secondo.value.handledNote).toBe('Primo tentativo andato a buon fine');
      expect(secondo.value.handledByName).toBe('Giulia Ferrari');
    }
  });

  it('un lead inesistente restituisce NOT_FOUND senza lanciare', async () => {
    const { bdc } = setup();
    const r = await bdc.markContacted(
      { eventId: 'evento-mai-esistito' as CrmOutboxEventId, note: null },
      BDC,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('NOT_FOUND');
    }
  });

  it('il filtro per giornata esclude le assenze di altri giorni', async () => {
    const { env, queueService, bdc, ctx } = setup();
    const a = await insert(env, makeAppointment());
    await queueService.markNoShow({ appointmentId: a.id, expectedVersion: 1 }, ctx);

    expect((await bdc.listLeads({ businessDate: '2026-09-09' })).leads).toHaveLength(0);
    // Senza giornata si vedono tutte quelle ancora in memoria.
    expect((await bdc.listLeads({ businessDate: null })).leads).toHaveLength(1);
  });

  it('con il CRM guasto il lead c’è comunque e si può chiudere: il BDC non aspetta il CRM', async () => {
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
    expect(view.leads[0]?.deliveryStatus).toBe('PENDING');

    const chiuso = await bdc.markContacted(
      { eventId: view.leads[0]?.eventId as CrmOutboxEventId, note: null },
      BDC,
    );
    expect(chiuso.ok && chiuso.value.handled).toBe(true);
  });
});
