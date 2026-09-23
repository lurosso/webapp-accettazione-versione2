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
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import type { PhoneE164 } from '@/domain/value-objects/phone';
import { buildTestEnv, makeAppointment, TestClock } from '../helpers/fixtures';

const TELEFONO = '+393331234560' as PhoneE164;

function setup(
  clock = new TestClock('2026-09-10T07:00:00.000Z'),
  portale: { readonly writesRequireToken?: boolean; readonly maxEarlyArrivalMinutes?: number } = {},
) {
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
    writesRequireToken: portale.writesRequireToken === true,
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
    ...(portale.maxEarlyArrivalMinutes === undefined
      ? {}
      : { maxEarlyArrivalMinutes: portale.maxEarlyArrivalMinutes }),
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
  it('riconosce i payload dei pulsanti, le etichette, il testo scritto a mano e il numero dell’opzione', () => {
    for (const testo of [
      'ACTION_ARRIVED',
      'action_arrived',
      'SONO_ARRIVATO',
      'Arrivato',
      'ARRIVATO',
      'sono arrivato',
      'Sono qui!',
      'arrivata',
      '1',
    ]) {
      expect(parseCustomerReply(testo)).toBe('ARRIVED');
    }
    for (const testo of [
      'ACTION_LATE',
      'IN_RITARDO',
      'In ritardo',
      'in ritardo di 10 minuti',
      'sono in ritardo',
      '2',
    ]) {
      expect(parseCustomerReply(testo)).toBe('LATE');
    }
    for (const testo of [
      'ACTION_ABSENT',
      'NON_POSSO_VENIRE',
      'Assente',
      'non vengo',
      'devo disdire',
      '3',
    ]) {
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
    expect(job?.renderedText).toContain(
      `Perfetto! Sei stato inserito in fila con il codice ${a.code}`,
    );
    // Senza segreto dei token (test) il link è quello per targa; con il segreto è /portal/<token>.
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

    const esito = await inbound.handle({ phone: '+393331234560', text: 'ACTION_LATE' });
    expect(esito.ok && esito.value.reply).toBe('LATE');
    expect(esito.ok && esito.value.replySent).toBe(true);

    const corrente = await env.appointments.findById(a.id);
    expect(corrente?.status).toBe('WAITING');
    expect(corrente?.customerLateNoticeAt).not.toBeNull();
    expect(corrente?.customerEtaAt).not.toBeNull();
    expect(eventi.some((e) => e.type === 'CUSTOMER_LATE_NOTICE')).toBe(true);

    // Al cliente parte la conferma del ritardo, una volta sola anche se ripete il tocco.
    const conferme = (await env.notifications.listByAppointment(a.id)).filter(
      (j) => j.kind === 'LATE_CONFIRMED',
    );
    expect(conferme).toHaveLength(1);
    expect(conferme[0]?.renderedText).toContain("Grazie per l'avviso!");
    const ripetuto = await inbound.handle({ phone: '+393331234560', text: 'ACTION_LATE' });
    expect(ripetuto.ok && ripetuto.value.repeated).toBe(true);
    expect(ripetuto.ok && ripetuto.value.replySent).toBe(false);
  });

  it('«Assente» segna il no-show con il motivo e crea il lead per il BDC', async () => {
    const { env, inbound } = setup();
    const a = await insert(
      env,
      makeAppointment({ customer: { ...makeAppointment().customer, phone: TELEFONO } }),
    );

    const esito = await inbound.handle({ phone: '+393331234560', text: 'ACTION_ABSENT' });
    expect(esito.ok && esito.value.reply).toBe('ABSENT');
    expect(esito.ok && esito.value.replySent).toBe(true);

    const corrente = await env.appointments.findById(a.id);
    expect(corrente?.status).toBe('NO_SHOW');
    expect(corrente?.noShowAt).not.toBeNull();

    // Al cliente parte la conferma dell'annullamento.
    const conferma = (await env.notifications.listByAppointment(a.id)).find(
      (j) => j.kind === 'ABSENT_CONFIRMED',
    );
    expect(conferma?.renderedText).toContain('Abbiamo annullato la prenotazione di oggi');

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

describe('WhatsAppInboundService: con PORTAL_WRITES_REQUIRE_TOKEN il numero basta', () => {
  it('«Sono arrivato» e «In ritardo» via WhatsApp funzionano anche quando dal portale serve il token', async () => {
    const { env, inbound } = setup(new TestClock('2026-09-10T07:00:00.000Z'), {
      writesRequireToken: true,
    });
    const a = await insert(
      env,
      makeAppointment({ customer: { ...makeAppointment().customer, phone: TELEFONO } }),
    );
    const ritardo = await inbound.handle({ phone: '+393331234560', text: 'ACTION_LATE' });
    expect(ritardo.ok && ritardo.value.reply).toBe('LATE');
    expect(ritardo.ok && ritardo.value.replySent).toBe(true);
    expect((await env.appointments.findById(a.id))?.customerLateNoticeAt).not.toBeNull();
    expect(
      (await env.notifications.listByAppointment(a.id)).some((j) => j.kind === 'LATE_CONFIRMED'),
    ).toBe(true);

    const arrivo = await inbound.handle({ phone: '+393331234560', text: 'ACTION_ARRIVED' });
    expect(arrivo.ok && arrivo.value.reply).toBe('ARRIVED');
    expect((await env.appointments.findById(a.id))?.customerArrivedAt).not.toBeNull();
  });
});

describe('WhatsAppInboundService: guardrail sull’arrivo prematuro', () => {
  /** Appuntamento alle 09:00 UTC (11:00 a Roma); l'orologio del test decide l'anticipo. */
  const alle0900 = () =>
    makeAppointment({
      scheduledAt: '2026-09-10T09:00:00.000Z' as IsoDateTime,
      customer: { ...makeAppointment().customer, phone: TELEFONO },
    });

  it('120 minuti prima: la pratica non si tocca e il cliente riceve il messaggio con l’orario e la finestra', async () => {
    const { env, inbound, eventi } = setup(new TestClock('2026-09-10T07:00:00.000Z'));
    const a = await insert(env, alle0900());
    const esito = await inbound.handle({ phone: '+393331234560', text: 'ACTION_ARRIVED' });
    expect(esito.ok).toBe(true);
    if (!esito.ok) {
      return;
    }
    expect(esito.value.reply).toBe('ARRIVED');
    expect(esito.value.premature).toBe(true);
    expect(esito.value.replySent).toBe(true);
    const dopo = await env.appointments.findById(a.id);
    expect(dopo?.status).toBe('WAITING');
    expect(dopo?.customerArrivedAt).toBeNull();
    expect(dopo?.version).toBe(a.version);
    expect(eventi.some((e) => e.type === 'CUSTOMER_ARRIVED')).toBe(false);
    const jobs = await env.notifications.listByAppointment(a.id);
    expect(jobs.some((j) => j.kind === 'ARRIVAL_CONFIRMED')).toBe(false);
    const presto = jobs.find((j) => j.kind === 'ARRIVAL_TOO_EARLY');
    expect(presto?.renderedText).toContain('previsto per le 11:00');
    expect(presto?.renderedText).toContain("È ancora un po' presto");
    expect(presto?.renderedText).toContain('al massimo 60 minuti prima');
  });

  it('un secondo tocco prematuro qualche minuto dopo riceve di nuovo la spiegazione, ma non due volte nello stesso minuto', async () => {
    const clock = new TestClock('2026-09-10T07:00:00.000Z');
    const { env, inbound } = setup(clock);
    const a = await insert(env, alle0900());
    await inbound.handle({ phone: '+393331234560', text: 'ACTION_ARRIVED' });
    await inbound.handle({ phone: '+393331234560', text: 'ACTION_ARRIVED' });
    clock.advance(5 * 60_000);
    await inbound.handle({ phone: '+393331234560', text: 'ACTION_ARRIVED' });
    const risposte = (await env.notifications.listByAppointment(a.id)).filter(
      (j) => j.kind === 'ARRIVAL_TOO_EARLY',
    );
    expect(risposte).toHaveLength(2);
  });

  it('30 minuti prima (o in orario, o dopo) l’arrivo è registrato come sempre, con codice e smart link', async () => {
    for (const ora of [
      '2026-09-10T08:30:00.000Z',
      '2026-09-10T09:00:00.000Z',
      '2026-09-10T09:40:00.000Z',
    ]) {
      const { env, inbound } = setup(new TestClock(ora));
      const a = await insert(env, alle0900());
      const esito = await inbound.handle({ phone: '+393331234560', text: 'ACTION_ARRIVED' });
      expect(esito.ok && esito.value.premature).toBe(false);
      expect(esito.ok && esito.value.repeated).toBe(false);
      expect((await env.appointments.findById(a.id))?.customerArrivedAt).toBe(ora);
      expect(
        (await env.notifications.listByAppointment(a.id)).some(
          (j) => j.kind === 'ARRIVAL_CONFIRMED',
        ),
      ).toBe(true);
    }
  });

  it('la finestra è configurabile: con 180 minuti, un tocco 120 minuti prima entra in fila', async () => {
    const { env, inbound } = setup(new TestClock('2026-09-10T07:00:00.000Z'), {
      maxEarlyArrivalMinutes: 180,
    });
    const a = await insert(env, alle0900());
    const esito = await inbound.handle({ phone: '+393331234560', text: 'ACTION_ARRIVED' });
    expect(esito.ok && esito.value.premature).toBe(false);
    expect((await env.appointments.findById(a.id))?.customerArrivedAt).not.toBeNull();
  });

  it('«In ritardo» e «Non posso venire» valgono a qualunque ora, anche molto prima dell’orario', async () => {
    const { env, inbound } = setup(new TestClock('2026-09-10T05:00:00.000Z'));
    const ritardo = await insert(env, alle0900());
    const esitoRitardo = await inbound.handle({ phone: '+393331234560', text: 'ACTION_LATE' });
    expect(esitoRitardo.ok && esitoRitardo.value.reply).toBe('LATE');
    expect((await env.appointments.findById(ritardo.id))?.customerLateNoticeAt).not.toBeNull();

    const assente = await insert(
      env,
      makeAppointment({
        scheduledAt: '2026-09-10T09:00:00.000Z' as IsoDateTime,
        customer: { ...makeAppointment().customer, phone: '+393331234561' as PhoneE164 },
      }),
    );
    const esitoAssente = await inbound.handle({ phone: '+393331234561', text: 'ACTION_ABSENT' });
    expect(esitoAssente.ok && esitoAssente.value.reply).toBe('ABSENT');
    expect((await env.appointments.findById(assente.id))?.status).toBe('NO_SHOW');
  });
});
