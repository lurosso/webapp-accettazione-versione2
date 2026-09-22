// Lo stato dell'ultimo WhatsApp sulla pratica: specchiato all'invio, portato avanti dal webhook di
// esito (inviato → consegnato → letto, oppure fallito), mai indietro, senza toccare la versione.
import { describe, expect, it } from 'vitest';
import {
  AppointmentWhatsAppMirror,
  WhatsAppDeliveryService,
  whatsappDeliveryFromJob,
  type DeliveryEvent,
} from '@/application/notifications/WhatsAppDeliveryService';
import type { NotificationJob } from '@/domain/entities/notification';
import type { DomainEvent } from '@/domain/events';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import type { PhoneE164 } from '@/domain/value-objects/phone';
import { NotificationOrchestrator } from '@/application/notifications/NotificationOrchestrator';
import { buildTestEnv, makeAppointment } from '../helpers/fixtures';

function setup() {
  const env = buildTestEnv();
  const eventi: DomainEvent[] = [];
  env.eventBus.subscribe((e) => {
    eventi.push(e);
  });
  // Orchestratore con lo specchio sulla pratica (quello delle fixture non lo ha).
  const orchestrator = new NotificationOrchestrator({
    spoki: env.spoki,
    smsHosting: env.smsHosting,
    notifications: env.notifications,
    clock: env.clock,
    ids: env.ids,
    logger: env.logger,
    eventBus: env.eventBus,
    whatsappDelivery: new AppointmentWhatsAppMirror(env.appointments, env.logger),
  });
  const service = new WhatsAppDeliveryService({
    appointments: env.appointments,
    notifications: env.notifications,
    orchestrator,
    clock: env.clock,
    logger: env.logger,
  });
  return { env, eventi, orchestrator, service };
}

async function pratica(env: ReturnType<typeof buildTestEnv>, phone = '+393331234560') {
  const r = await env.appointments.insert(
    makeAppointment({
      status: 'IN_PROGRESS',
      customer: {
        ...makeAppointment().customer,
        phone: phone as PhoneE164,
      },
    }),
  );
  if (!r.ok) {
    throw new Error(r.error.message);
  }
  return r.value;
}

async function invia(
  ctx: ReturnType<typeof setup>,
  a: Awaited<ReturnType<typeof pratica>>,
): Promise<NotificationJob> {
  const brands = await ctx.env.referenceData.listBrands();
  const brand = brands.find((b) => b.id === a.brandId);
  if (brand === undefined) {
    throw new Error('marchio non trovato');
  }
  const run = await ctx.orchestrator.sendReminder({
    appointment: a,
    brand,
    kind: 'CHECK_IN_STARTED',
    correlationId: 'c-1',
  });
  return run.job;
}

function idDi(job: NotificationJob): string | null {
  return job.attempts.find((t) => t.channel === 'WHATSAPP')?.providerMessageId ?? null;
}

function esito(job: NotificationJob, overrides: Partial<DeliveryEvent> = {}): DeliveryEvent {
  const tentativo = job.attempts.find((t) => t.channel === 'WHATSAPP');
  return {
    kind: 'DELIVERY',
    providerMessageId: tentativo?.providerMessageId ?? 'sconosciuto',
    state: 'DELIVERED',
    occurredAt: '2026-09-10T08:05:00.000Z' as IsoDateTime,
    reason: null,
    recipient: job.recipientPhone,
    metadata: null,
    eventId: null,
    ...overrides,
  };
}

describe('Specchio dello stato WhatsApp sulla pratica', () => {
  it("all'invio la pratica dice «WhatsApp inviato/consegnato» senza cambiare versione", async () => {
    const ctx = setup();
    const a = await pratica(ctx.env);
    const job = await invia(ctx, a);
    expect(job.currentChannel).toBe('WHATSAPP');
    const dopo = await ctx.env.appointments.findById(a.id);
    expect(dopo?.whatsapp?.kind).toBe('CHECK_IN_STARTED');
    expect(['SENT', 'DELIVERED']).toContain(dopo?.whatsapp?.state);
    expect(dopo?.whatsapp?.providerMessageId).toBe(
      job.attempts.find((t) => t.channel === 'WHATSAPP')?.providerMessageId ?? null,
    );
    expect(dopo?.version).toBe(a.version);
  });

  it('quando WhatsApp fallisce e si passa all’SMS la pratica dice «WhatsApp non consegnato»', async () => {
    const ctx = setup();
    // Ultima cifra 9: il finto Spoki rifiuta il numero, l'orchestratore ripiega sull'SMS.
    const a = await pratica(ctx.env, '+393331234569');
    const job = await invia(ctx, a);
    expect(job.currentChannel).toBe('SMS');
    expect(whatsappDeliveryFromJob(job)?.state).toBe('FAILED');
    expect((await ctx.env.appointments.findById(a.id))?.whatsapp?.state).toBe('FAILED');
  });

  it('un job senza tentativo WhatsApp (cliente senza consenso) non lascia nulla sulla pratica', async () => {
    const ctx = setup();
    const r = await ctx.env.appointments.insert(
      makeAppointment({
        status: 'IN_PROGRESS',
        customer: { ...makeAppointment().customer, whatsappOptIn: false },
      }),
    );
    if (!r.ok) {
      throw new Error(r.error.message);
    }
    const job = await invia(ctx, r.value);
    expect(job.currentChannel).toBe('SMS');
    expect(whatsappDeliveryFromJob(job)).toBeNull();
    expect((await ctx.env.appointments.findById(r.value.id))?.whatsapp).toBeNull();
  });
});

describe('Esiti dal webhook di Spoki', () => {
  it('consegnato e poi letto: job e pratica avanzano, con un evento per ogni passo', async () => {
    const ctx = setup();
    const a = await pratica(ctx.env);
    const job = await invia(ctx, a);
    // Il mock consegna subito: si riparte da SENT per provare l'intera scala.
    await ctx.env.notifications.updateJob({ ...job, status: 'SENT' });
    const prima = ctx.eventi.length;

    const consegnato = await ctx.service.applyDelivery(esito(job, { eventId: 'e-1' }), 'corr');
    expect(consegnato.handled && consegnato.job.status).toBe('DELIVERED');
    expect((await ctx.env.appointments.findById(a.id))?.whatsapp?.state).toBe('DELIVERED');

    const letto = await ctx.service.applyDelivery(
      esito(job, { state: 'READ', eventId: 'e-2' }),
      'corr',
    );
    expect(letto.handled && letto.job.status).toBe('READ');
    const dopo = await ctx.env.appointments.findById(a.id);
    expect(dopo?.whatsapp?.state).toBe('READ');
    expect(dopo?.version).toBe(a.version);
    // Il tentativo WhatsApp risulta consegnato.
    expect(letto.handled && letto.job.attempts.find((t) => t.channel === 'WHATSAPP')?.outcome).toBe(
      'DELIVERED',
    );
    expect(
      ctx.eventi.slice(prima).filter((e) => e.type === 'NOTIFICATION_JOB_CHANGED'),
    ).toHaveLength(2);
  });

  it('un esito arrivato in ritardo non porta indietro il messaggio (letto resta letto)', async () => {
    const ctx = setup();
    const a = await pratica(ctx.env);
    const job = await invia(ctx, a);
    await ctx.service.applyDelivery(esito(job, { state: 'READ' }), 'corr');
    const tardivo = await ctx.service.applyDelivery(esito(job, { state: 'DELIVERED' }), 'corr');
    expect(tardivo.handled && tardivo.job.status).toBe('READ');
    expect((await ctx.env.appointments.findById(a.id))?.whatsapp?.state).toBe('READ');
  });

  it('un esito fallito marca job e pratica come non consegnati, con il motivo sul tentativo', async () => {
    const ctx = setup();
    const a = await pratica(ctx.env);
    const job = await invia(ctx, a);
    const fallito = await ctx.service.applyDelivery(
      esito(job, { state: 'FAILED', reason: 'Numero non su WhatsApp' }),
      'corr',
    );
    expect(fallito.handled && fallito.job.status).toBe('FAILED');
    expect(
      fallito.handled && fallito.job.attempts.find((t) => t.channel === 'WHATSAPP')?.errorMessage,
    ).toBe('Numero non su WhatsApp');
    expect((await ctx.env.appointments.findById(a.id))?.whatsapp?.state).toBe('FAILED');
  });

  it('lo stesso evento ripetuto dal provider è ignorato; un messaggio sconosciuto è handled:false', async () => {
    const ctx = setup();
    const a = await pratica(ctx.env);
    const job = await invia(ctx, a);
    await ctx.service.applyDelivery(esito(job, { eventId: 'e-dup' }), 'corr');
    const ripetuto = await ctx.service.applyDelivery(esito(job, { eventId: 'e-dup' }), 'corr');
    expect(ripetuto).toEqual({ handled: false, reason: 'DUPLICATE_EVENT' });
    const ignoto = await ctx.service.applyDelivery(
      esito(job, { providerMessageId: 'mai-visto', recipient: null }),
      'corr',
    );
    expect(ignoto).toEqual({ handled: false, reason: 'UNKNOWN_MESSAGE' });
  });

  it('senza id noto il messaggio si ritrova dalla chiave di idempotenza nei metadati, o dal numero', async () => {
    const ctx = setup();
    const a = await pratica(ctx.env);
    const job = await invia(ctx, a);
    await ctx.env.notifications.updateJob({ ...job, status: 'SENT' });

    const perChiave = await ctx.service.applyDelivery(
      esito(job, {
        providerMessageId: 'id-di-spoki-mai-tornato',
        recipient: null,
        metadata: { idempotency_key: `${job.idempotencyKey}:WA:1` },
      }),
      'corr',
    );
    expect(perChiave.handled && perChiave.job.id).toBe(job.id);
    expect(perChiave.handled && perChiave.job.status).toBe('DELIVERED');

    const perNumero = await ctx.service.applyDelivery(
      esito(job, { providerMessageId: 'altro-id', state: 'READ', metadata: null }),
      'corr',
    );
    expect(perNumero.handled && perNumero.job.id).toBe(job.id);
    expect(perNumero.handled && perNumero.job.status).toBe('READ');
  });

  it('un job già passato all’SMS non cambia per un webhook WhatsApp tardivo', async () => {
    const ctx = setup();
    const a = await pratica(ctx.env, '+393331234569');
    const job = await invia(ctx, a);
    expect(job.currentChannel).toBe('SMS');
    const r = await ctx.service.applyDelivery(
      esito(job, { providerMessageId: 'x', recipient: job.recipientPhone, state: 'DELIVERED' }),
      'corr',
    );
    // Il numero coincide ma il canale corrente non è WhatsApp: l'orchestratore lascia tutto com'è.
    expect(r.handled ? r.job.status : null).toBe(r.handled ? job.status : null);
    expect((await ctx.env.appointments.findById(a.id))?.whatsapp?.state).toBe('FAILED');
  });

  it('lo stesso event_uuid con stati diversi è una progressione, non un ritento; il ritento vero è (id, stato)', async () => {
    const ctx = setup();
    const a = await pratica(ctx.env);
    const job = await invia(ctx, a);
    await ctx.env.notifications.updateJob({ ...job, status: 'SENT' });
    const stessoId = 'ev-del-messaggio';
    const consegnato = await ctx.service.applyDelivery(
      esito(job, { state: 'DELIVERED', eventId: stessoId }),
      'corr',
    );
    expect(consegnato.handled && consegnato.job.status).toBe('DELIVERED');
    const letto = await ctx.service.applyDelivery(
      esito(job, { state: 'READ', eventId: stessoId }),
      'corr',
    );
    expect(letto.handled && letto.job.status).toBe('READ');
    const ritento = await ctx.service.applyDelivery(
      esito(job, { state: 'READ', eventId: stessoId }),
      'corr',
    );
    expect(ritento).toEqual({ handled: false, reason: 'DUPLICATE_EVENT' });
  });

  it('un esito per un messaggio ancora sconosciuto non brucia il suo event_uuid: può tornare', async () => {
    const ctx = setup();
    const a = await pratica(ctx.env);
    const job = await invia(ctx, a);
    const prima = await ctx.service.applyDelivery(
      esito(job, { providerMessageId: 'ancora-ignoto', recipient: null, eventId: 'ev-presto' }),
      'corr',
    );
    expect(prima).toEqual({ handled: false, reason: 'UNKNOWN_MESSAGE' });
    const dopo = await ctx.service.applyDelivery(
      esito(job, {
        providerMessageId: 'ancora-ignoto',
        recipient: null,
        eventId: 'ev-presto',
        metadata: { idempotency_key: job.idempotencyKey },
      }),
      'corr',
    );
    expect(dopo.handled).toBe(true);
  });

  it('quando l’id di Spoki non coincide con il nostro, l’esito lega il tentativo in volo e da lì si ritrova per id', async () => {
    const ctx = setup();
    const a = await pratica(ctx.env);
    const job = await invia(ctx, a);
    await ctx.env.notifications.updateJob({ ...job, status: 'SENT' });
    const nostro = idDi(job);
    const consegnato = await ctx.service.applyDelivery(
      esito(job, {
        providerMessageId: 'uuid-di-spoki',
        recipient: null,
        metadata: { idempotency_key: `${job.idempotencyKey}:WA:1` },
      }),
      'corr',
    );
    expect(consegnato.handled && consegnato.job.status).toBe('DELIVERED');
    const tentativo = consegnato.handled
      ? consegnato.job.attempts.find((t) => t.channel === 'WHATSAPP')
      : undefined;
    expect(tentativo?.providerMessageId).toBe('uuid-di-spoki');
    expect(tentativo?.providerMessageId).not.toBe(nostro);
    expect((await ctx.env.appointments.findById(a.id))?.whatsapp?.providerMessageId).toBe(
      'uuid-di-spoki',
    );
    // Il passo successivo arriva con il solo id di Spoki: nessun metadato, nessun numero.
    const letto = await ctx.service.applyDelivery(
      esito(job, { providerMessageId: 'uuid-di-spoki', state: 'READ', recipient: null }),
      'corr',
    );
    expect(letto.handled && letto.job.status).toBe('READ');
  });

  it('un tentativo WhatsApp fallito in precedenza non viene toccato dall’esito del tentativo riuscito', async () => {
    const ctx = setup();
    const a = await pratica(ctx.env);
    const job = await invia(ctx, a);
    const riuscito = job.attempts.find((t) => t.channel === 'WHATSAPP');
    if (riuscito === undefined) {
      throw new Error('tentativo atteso');
    }
    const fallito = {
      ...riuscito,
      id: `${riuscito.id}-precedente` as typeof riuscito.id,
      attemptNo: 0,
      providerMessageId: null,
      outcome: 'FAILED' as const,
      errorCode: 'TIMEOUT',
      errorMessage: 'Spoki non ha risposto in tempo.',
      retryable: true,
    };
    const conStoria = await ctx.env.notifications.updateJob({
      ...job,
      status: 'SENT',
      attempts: [fallito, riuscito],
    });
    const consegnato = await ctx.service.applyDelivery(esito(conStoria), 'corr');
    if (!consegnato.handled) {
      throw new Error('esito atteso');
    }
    expect(consegnato.job.attempts[0]).toEqual(fallito);
    expect(consegnato.job.attempts[1]?.outcome).toBe('DELIVERED');
  });
});
