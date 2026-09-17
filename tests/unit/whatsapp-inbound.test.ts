// Risposte del cliente su WhatsApp: «Arrivato», «In ritardo», «Assente».
import { describe, expect, it } from 'vitest';
import { CustomerPortalService } from '@/application/portal/CustomerPortalService';
import { QueueService } from '@/application/queue/QueueService';
import {
  CUSTOMER_ABSENT_REASON,
  WhatsAppInboundService,
  parseCustomerReply,
} from '@/application/notifications/WhatsAppInboundService';
import type { Appointment } from '@/domain/entities/appointment';
import type { DomainEvent } from '@/domain/events';
import type { PhoneE164 } from '@/domain/value-objects/phone';
import { buildTestEnv, makeAppointment, TestClock } from '../helpers/fixtures';

const TELEFONO = '+393331234560' as PhoneE164;

function setup(clock = new TestClock('2026-09-10T07:00:00.000Z')) {
  const env = buildTestEnv(clock);
  const eventi: DomainEvent[] = [];
  env.eventBus.subscribe((e) => {
    eventi.push(e);
  });
  const portal = new CustomerPortalService({
    appointments: env.appointments,
    referenceData: env.referenceData,
    operators: env.operators,
    eventBus: env.eventBus,
    clock,
    ids: env.ids,
    logger: env.logger,
    tokens: null,
  });
  const queueService = new QueueService({
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
  const inbound = new WhatsAppInboundService({
    appointments: env.appointments,
    referenceData: env.referenceData,
    portal,
    queueService,
    orchestrator: env.orchestrator,
    eventBus: env.eventBus,
    clock,
    ids: env.ids,
    logger: env.logger,
  });
  return { env, clock, inbound, eventi };
}

async function insert(env: ReturnType<typeof buildTestEnv>, a: Appointment): Promise<Appointment> {
  const r = await env.appointments.insert(a);
  if (!r.ok) {
    throw new Error(r.error.message);
  }
  return r.value;
}

describe('parseCustomerReply: le tre risposte del messaggio', () => {
  it('riconosce pulsanti, testo scritto a mano e numero dell’opzione', () => {
    for (const testo of ['Arrivato', 'ARRIVATO', 'sono arrivato', 'Sono qui!', 'arrivata', '1']) {
      expect(parseCustomerReply(testo)).toBe('ARRIVED');
    }
    for (const testo of ['In ritardo', 'in ritardo di 10 minuti', 'sono in ritardo', '2']) {
      expect(parseCustomerReply(testo)).toBe('LATE');
    }
    for (const testo of ['Assente', 'non vengo', 'devo disdire', '3']) {
      expect(parseCustomerReply(testo)).toBe('ABSENT');
    }
  });

  it('ignora tutto il resto: sul numero dell’officina arriva di tutto', () => {
    for (const testo of ['grazie', 'ok', '', '   ', 'a che ora?', null, undefined]) {
      expect(parseCustomerReply(testo)).toBeNull();
    }
  });
});

describe('WhatsAppInboundService: risposta «Arrivato»', () => {
  it('annota l’ora di arrivo, pubblica l’evento e risponde con codice e link', async () => {
    const { env, inbound, eventi } = setup();
    const a = await insert(
      env,
      makeAppointment({ customer: { ...makeAppointment().customer, phone: TELEFONO } }),
    );

    const esito = await inbound.handle({ phone: '333 123 4560', text: 'Arrivato' });
    expect(esito.ok).toBe(true);
    if (esito.ok) {
      expect(esito.value.reply).toBe('ARRIVED');
      expect(esito.value.repeated).toBe(false);
      expect(esito.value.replySent).toBe(true);
    }

    // La pratica resta in coda: l'ordine lo decide l'accettatore, non chi risponde per primo.
    const corrente = await env.appointments.findById(a.id);
    expect(corrente?.status).toBe('WAITING');
    expect(corrente?.customerArrivedAt).toBe('2026-09-10T07:00:00.000Z');

    const arrivo = eventi.find((e) => e.type === 'CUSTOMER_ARRIVED');
    expect(arrivo).toBeDefined();
    expect(arrivo?.actor.kind).toBe('CUSTOMER');

    // Al cliente parte la risposta con il link di tracciamento.
    const job = (await env.notifications.listByAppointment(a.id)).find(
      (j) => j.kind === 'ARRIVAL_CONFIRMED',
    );
    expect(job).toBeDefined();
    expect(job?.renderedText).toContain(a.code);
    expect(job?.renderedText).toContain('/portal?targa=');
  });

  it('il secondo tocco non sposta l’ora né manda un altro messaggio', async () => {
    const { env, inbound } = setup();
    const a = await insert(
      env,
      makeAppointment({ customer: { ...makeAppointment().customer, phone: TELEFONO } }),
    );

    await inbound.handle({ phone: '+393331234560', text: 'Arrivato' });
    const prima = (await env.appointments.findById(a.id))?.customerArrivedAt;
    env.clock.advance(5 * 60_000);
    const secondo = await inbound.handle({ phone: '+393331234560', text: 'sono arrivato' });

    expect(secondo.ok && secondo.value.repeated).toBe(true);
    expect((await env.appointments.findById(a.id))?.customerArrivedAt).toBe(prima);
    const job = (await env.notifications.listByAppointment(a.id)).filter(
      (j) => j.kind === 'ARRIVAL_CONFIRMED',
    );
    expect(job).toHaveLength(1);
  });
});

describe('WhatsAppInboundService: «In ritardo» e «Assente»', () => {
  it('«In ritardo» sposta l’arrivo atteso come il pulsante del portale', async () => {
    const { env, inbound, eventi } = setup();
    const a = await insert(
      env,
      makeAppointment({ customer: { ...makeAppointment().customer, phone: TELEFONO } }),
    );

    const esito = await inbound.handle({ phone: '+393331234560', text: 'In ritardo' });
    expect(esito.ok && esito.value.reply).toBe('LATE');

    const corrente = await env.appointments.findById(a.id);
    expect(corrente?.status).toBe('WAITING');
    expect(corrente?.customerLateNoticeAt).not.toBeNull();
    expect(corrente?.customerEtaAt).not.toBeNull();
    expect(eventi.some((e) => e.type === 'CUSTOMER_LATE_NOTICE')).toBe(true);
  });

  it('«Assente» segna il no-show con il motivo e crea il lead per il BDC', async () => {
    const { env, inbound } = setup();
    const a = await insert(
      env,
      makeAppointment({ customer: { ...makeAppointment().customer, phone: TELEFONO } }),
    );

    const esito = await inbound.handle({ phone: '+393331234560', text: 'non vengo' });
    expect(esito.ok && esito.value.reply).toBe('ABSENT');

    const corrente = await env.appointments.findById(a.id);
    expect(corrente?.status).toBe('NO_SHOW');
    expect(corrente?.noShowAt).not.toBeNull();

    // Il BDC lo trova nel proprio elenco, con scritto che è stato il cliente a dirlo: il motivo
    // viaggia accanto al payload, ed è la riga che il back office legge prima di telefonare.
    const eventi = await env.crmOutbox.listByStatus(['SENT', 'PENDING', 'FAILED', 'MANUAL']);
    const noShow = eventi.filter((e) => e.type === 'NO_SHOW');
    expect(noShow).toHaveLength(1);
    expect(noShow[0]?.operatorNote).toBe(CUSTOMER_ABSENT_REASON);

    // Ripetere la risposta non genera un secondo lead.
    const ripetuta = await inbound.handle({ phone: '+393331234560', text: 'Assente' });
    expect(ripetuta.ok && ripetuta.value.repeated).toBe(true);
    expect(
      (await env.crmOutbox.listByStatus(['SENT', 'PENDING', 'FAILED', 'MANUAL'])).filter(
        (e) => e.type === 'NO_SHOW',
      ),
    ).toHaveLength(1);
  });
});

describe('WhatsAppInboundService: messaggi che non riguardano nessuna pratica', () => {
  it('un testo qualunque è VALIDATION, un numero senza pratica di oggi è NOT_FOUND', async () => {
    const { env, inbound } = setup();
    await insert(
      env,
      makeAppointment({ customer: { ...makeAppointment().customer, phone: TELEFONO } }),
    );

    const qualunque = await inbound.handle({ phone: '+393331234560', text: 'grazie mille' });
    expect(!qualunque.ok && qualunque.error.code).toBe('VALIDATION');

    const sconosciuto = await inbound.handle({ phone: '+393339999999', text: 'Arrivato' });
    expect(!sconosciuto.ok && sconosciuto.error.code).toBe('NOT_FOUND');

    const numeroRotto = await inbound.handle({ phone: 'pippo', text: 'Arrivato' });
    expect(!numeroRotto.ok && numeroRotto.error.code).toBe('VALIDATION');
  });

  it('una pratica già in accettazione non viene toccata da un «Arrivato» tardivo', async () => {
    const { env, inbound } = setup();
    const a = await insert(
      env,
      makeAppointment({
        status: 'IN_PROGRESS',
        customer: { ...makeAppointment().customer, phone: TELEFONO },
      }),
    );

    const esito = await inbound.handle({ phone: '+393331234560', text: 'Arrivato' });
    expect(esito.ok && esito.value.repeated).toBe(true);
    const corrente = await env.appointments.findById(a.id);
    expect(corrente?.status).toBe('IN_PROGRESS');
    expect(corrente?.customerArrivedAt).toBeNull();
  });
});
