// Regola del terzo «Salta»: la stessa pratica saltata tre volte di fila diventa un'anomalia —
// «Cliente saltato 3 volte - Verificare presenza» — che arriva al BDC (cruscotto dei lead) e
// all'amministratore (anomalie di giornata), una volta sola. Se poi il cliente viene preso in
// carico l'anomalia si chiude da sola: il BDC non telefona a chi è già al banco.
import { describe, expect, it } from 'vitest';
import { BdcLeadService } from '@/application/crm/BdcLeadService';
import { CrmNotifier } from '@/application/crm/CrmNotifier';
import {
  excessiveSkipsDescription,
  QueueService,
  type ActionContext,
} from '@/application/queue/QueueService';
import type { Appointment } from '@/domain/entities/appointment';
import { asOperatorId, asWorkstationId } from '@/domain/ids';
import { CrmServiceMock } from '@/services/mocks/CrmServiceMock';
import { buildTestEnv, makeAppointment, TEST_DATE } from '../helpers/fixtures';

/** Con `crmGiu` il CRM risponde sempre con un errore: il banco non deve accorgersene. */
function setup(crmGiu = false) {
  const env = buildTestEnv();
  const crmNotifier = crmGiu
    ? new CrmNotifier({
        crm: new CrmServiceMock(
          { mode: 'error', latencyMs: 0 },
          { clock: env.clock, logger: env.logger },
        ),
        outbox: env.crmOutbox,
        referenceData: env.referenceData,
        clock: env.clock,
        ids: env.ids,
        logger: env.logger,
      })
    : env.crmNotifier;
  const queueService = new QueueService({
    appointments: env.appointments,
    referenceData: env.referenceData,
    operators: env.operators,
    notifications: env.notifications,
    crmNotifier,
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
    correlationId: 'corr-salti',
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

/** Salta la pratica `volte` volte, ripristinandola fra un salto e l'altro come fa il banco. */
async function salta(
  { queueService, ctx }: ReturnType<typeof setup>,
  a: Appointment,
  volte: number,
): Promise<Appointment> {
  let corrente = a;
  for (let i = 0; i < volte; i += 1) {
    if (corrente.status === 'SKIPPED') {
      const ripristinata = await queueService.restore(
        { appointmentId: corrente.id, expectedVersion: corrente.version },
        ctx,
      );
      if (!ripristinata.ok) {
        throw new Error(ripristinata.error.message);
      }
      corrente = ripristinata.value;
    }
    const saltata = await queueService.skip(
      { appointmentId: corrente.id, expectedVersion: corrente.version },
      ctx,
    );
    if (!saltata.ok) {
      throw new Error(saltata.error.message);
    }
    corrente = saltata.value;
  }
  return corrente;
}

describe('Anomalia al terzo «Salta» consecutivo', () => {
  it('due salti non segnalano niente', async () => {
    const s = setup();
    const a = await insert(s.env, makeAppointment());
    await salta(s, a, 2);
    const view = await s.bdc.listLeads({ businessDate: TEST_DATE });
    expect(view.leads).toHaveLength(0);
    expect(s.env.crm.received).toHaveLength(0);
  });

  it('al terzo salto nasce l’anomalia «Verificare presenza», per il BDC e per il CRM', async () => {
    const s = setup();
    const a = await insert(s.env, makeAppointment());
    const saltata = await salta(s, a, 3);
    expect(saltata.skipCount).toBe(3);

    const view = await s.bdc.listLeads({ businessDate: TEST_DATE });
    expect(view.openCount).toBe(1);
    const [lead] = view.leads;
    expect(lead?.type).toBe('ANOMALY');
    expect(lead?.anomalyKind).toBe('EXCESSIVE_SKIPS');
    expect(lead?.code).toBe(a.code);
    expect(lead?.phone).toBe(a.customer.phone);
    expect(lead?.reason).toBe('Cliente saltato 3 volte - Verificare presenza');
    expect(lead?.handled).toBe(false);

    // Consegnato al CRM con il tipo di anomalia e la stessa frase.
    expect(s.env.crm.received).toHaveLength(1);
    expect(s.env.crm.received[0]).toMatchObject({
      anomalyKind: 'EXCESSIVE_SKIPS',
      code: a.code,
      description: excessiveSkipsDescription(3),
    });

    // Filtri per tipo: l'amministratore chiede le sole anomalie, il BDC può chiedere i soli assenti.
    expect(
      (await s.bdc.listLeads({ businessDate: TEST_DATE, types: ['ANOMALY'] })).leads,
    ).toHaveLength(1);
    expect(
      (await s.bdc.listLeads({ businessDate: TEST_DATE, types: ['NO_SHOW'] })).leads,
    ).toHaveLength(0);
  });

  it('il quarto salto non apre una seconda anomalia né rispedisce l’evento', async () => {
    const s = setup();
    const a = await insert(s.env, makeAppointment());
    await salta(s, a, 4);
    const view = await s.bdc.listLeads({ businessDate: TEST_DATE, includeHandled: true });
    expect(view.leads).toHaveLength(1);
    expect(s.env.crm.received).toHaveLength(1);
  });

  it('se poi il cliente viene preso in carico, l’anomalia si chiude da sola con la nota', async () => {
    const s = setup();
    const a = await insert(s.env, makeAppointment());
    const saltata = await salta(s, a, 3);
    const presa = await s.queueService.takeInCharge(
      { appointmentId: saltata.id, expectedVersion: saltata.version, bayId: null },
      s.ctx,
    );
    expect(presa.ok).toBe(true);

    const aperte = await s.bdc.listLeads({ businessDate: TEST_DATE });
    expect(aperte.openCount).toBe(0);
    const tutte = await s.bdc.listLeads({ businessDate: TEST_DATE, includeHandled: true });
    expect(tutte.leads[0]?.handled).toBe(true);
    expect(tutte.leads[0]?.handledNote).toContain('Cliente presente');
  });

  it('un CRM guasto non ferma il «Salta»: l’anomalia resta in coda di uscita e il BDC la vede', async () => {
    const s = setup(true);
    const a = await insert(s.env, makeAppointment());
    const saltata = await salta(s, a, 3);
    expect(saltata.status).toBe('SKIPPED');
    const view = await s.bdc.listLeads({ businessDate: TEST_DATE });
    expect(view.leads[0]?.anomalyKind).toBe('EXCESSIVE_SKIPS');
    // Il CRM l'ha rifiutata: la riga resta da lavorare, e la consegna si riprova dal pannello Sistema.
    expect(view.leads[0]?.handled).toBe(false);
    expect(view.leads[0]?.deliveryStatus).not.toBe('SENT');
  });
});

describe('Terzo «Salta»: la serie è consecutiva e si riapre', () => {
  async function prendiERilascia(
    s: ReturnType<typeof setup>,
    a: Appointment,
  ): Promise<Appointment> {
    const presa = await s.queueService.takeInCharge(
      { appointmentId: a.id, expectedVersion: a.version, bayId: null },
      s.ctx,
    );
    if (!presa.ok) {
      throw new Error(presa.error.message);
    }
    expect(presa.value.skipCount).toBe(0);
    const rilasciata = await s.queueService.release(
      { appointmentId: a.id, expectedVersion: presa.value.version },
      s.ctx,
    );
    if (!rilasciata.ok) {
      throw new Error(rilasciata.error.message);
    }
    return rilasciata.value;
  }

  it('un salto, una presa in carico e due salti non sono tre salti di fila', async () => {
    const s = setup();
    const a = await insert(s.env, makeAppointment());
    const saltata = await salta(s, a, 1);
    const ripristinata = await s.queueService.restore(
      { appointmentId: saltata.id, expectedVersion: saltata.version },
      s.ctx,
    );
    if (!ripristinata.ok) {
      throw new Error(ripristinata.error.message);
    }
    const rimessa = await prendiERilascia(s, ripristinata.value);
    await salta(s, rimessa, 2);
    expect((await s.bdc.listLeads({ businessDate: TEST_DATE })).leads).toHaveLength(0);
  });

  it('presa in carico e poi rimessa in coda: altri tre salti riaprono l’anomalia della giornata', async () => {
    const s = setup();
    const a = await insert(s.env, makeAppointment());
    const saltata = await salta(s, a, 3);
    const ripristinata = await s.queueService.restore(
      { appointmentId: saltata.id, expectedVersion: saltata.version },
      s.ctx,
    );
    if (!ripristinata.ok) {
      throw new Error(ripristinata.error.message);
    }
    const rimessa = await prendiERilascia(s, ripristinata.value);
    expect((await s.bdc.listLeads({ businessDate: TEST_DATE })).openCount).toBe(0);

    await salta(s, rimessa, 3);
    const view = await s.bdc.listLeads({ businessDate: TEST_DATE, includeHandled: true });
    expect(view.leads).toHaveLength(1);
    expect(view.openCount).toBe(1);
    expect(view.leads[0]?.handled).toBe(false);
  });

  it('chiusa a mano, il quarto salto della stessa serie non la riapre', async () => {
    const s = setup();
    const a = await insert(s.env, makeAppointment());
    const saltata = await salta(s, a, 3);
    const [lead] = (await s.bdc.listLeads({ businessDate: TEST_DATE })).leads;
    if (lead === undefined) {
      throw new Error('anomalia assente');
    }
    // Chiusa a mano (dal CRM o dall'assistenza): l'evento in coda di uscita è MANUAL.
    const evento = await s.env.crmOutbox.findById(lead.eventId as never);
    if (evento === null) {
      throw new Error('evento assente');
    }
    await s.env.crmOutbox.update({ ...evento, status: 'MANUAL', handledNote: 'Verificato' });
    await salta(s, saltata, 1);
    expect((await s.bdc.listLeads({ businessDate: TEST_DATE })).openCount).toBe(0);
  });
});
