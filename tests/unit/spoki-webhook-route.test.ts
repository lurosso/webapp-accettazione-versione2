// POST /api/v1/webhooks/spoki dal punto di vista di Spoki: esiti firmati che aggiornano job e
// pratica, firme sbagliate rifiutate, risposte del cliente ancora accettate, 404 quando la rotta è
// spenta. Il Route Handler gira su un container isolato installato al posto di quello globale.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST } from '@/app/api/v1/webhooks/spoki/route';
import {
  createContainer,
  resetContainerForTests,
  setContainerForTests,
  type Container,
} from '@/config/container';
import type { Appointment } from '@/domain/entities/appointment';
import type { NotificationJob } from '@/domain/entities/notification';
import type { PhoneE164 } from '@/domain/value-objects/phone';
import { buildSpokiSignatureHeader } from '@/lib/http/spoki-signature';
import { InMemoryStore } from '@/repositories/in-memory/InMemoryStore';
import { NoopLogger } from '@/services/mocks/ConsoleLogger';
import { makeAppointment, TestClock } from '../helpers/fixtures';

const SEGRETO_WEBHOOK = 'whsec_0123456789abcdef0123456789abcdef';
const SEGRETO_INBOUND = 'inbound-0123456789abcdef0123456789abcdef';
const ORIGINE = 'http://officina.local';

let container: Container;
let clock: TestClock;

type Init = ConstructorParameters<typeof NextRequest>[1];

function richiesta(
  body: unknown,
  headers: Record<string, string> = {},
  init: Init = {},
): NextRequest {
  const corpo = typeof body === 'string' ? body : JSON.stringify(body);
  return new NextRequest(`${ORIGINE}/api/v1/webhooks/spoki`, {
    method: 'POST',
    body: corpo,
    headers: { 'content-type': 'application/json', ...headers },
    ...init,
  });
}

/** Evento V2 `message.outbound` firmato come lo manderebbe Spoki. */
function esitoFirmato(
  uuid: string,
  sendStatus: string,
  extra: Record<string, unknown> = {},
  eventUuid = `ev-${uuid}-${sendStatus}`,
): NextRequest {
  const corpo = JSON.stringify({
    version: 2,
    event: 'message.outbound',
    event_uuid: eventUuid,
    timestamp: clock.now().getTime() / 1000,
    data: {
      uuid,
      send_status: sendStatus,
      to_phone: '+393331234560',
      sent_datetime: clock.nowIso(),
      ...extra,
    },
  });
  return richiesta(corpo, {
    'x-spoki-signature': buildSpokiSignatureHeader(
      corpo,
      SEGRETO_WEBHOOK,
      Math.floor(clock.now().getTime() / 1000),
    ),
  });
}

async function praticaInCarico(): Promise<Appointment> {
  const r = await container.repos.appointments.insert(
    makeAppointment({
      status: 'IN_PROGRESS',
      businessDate: clock.today(),
      customer: { ...makeAppointment().customer, phone: '+393331234560' as PhoneE164 },
    }),
  );
  if (!r.ok) {
    throw new Error(r.error.message);
  }
  return r.value;
}

/** Invia il benvenuto e riporta il job a SENT (il finto Spoki consegna subito). */
async function benvenutoInviato(a: Appointment): Promise<NotificationJob> {
  const brands = await container.repos.referenceData.listBrands();
  const brand = brands.find((b) => b.id === a.brandId);
  if (brand === undefined) {
    throw new Error('marchio non trovato');
  }
  const run = await container.notificationOrchestrator.sendReminder({
    appointment: a,
    brand,
    kind: 'CHECK_IN_STARTED',
    correlationId: 'c-test',
  });
  return container.repos.notifications.updateJob({ ...run.job, status: 'SENT' });
}

function idMessaggio(job: NotificationJob): string {
  const id = job.attempts.find((t) => t.channel === 'WHATSAPP')?.providerMessageId;
  if (id === null || id === undefined) {
    throw new Error('nessun tentativo WhatsApp');
  }
  return id;
}

beforeAll(() => {
  clock = new TestClock('2026-09-10T08:00:00.000Z');
  container = createContainer({
    env: {
      spokiWebhookSecret: SEGRETO_WEBHOOK,
      spokiInboundSecret: SEGRETO_INBOUND,
      messagingStandby: false,
      messagingTriggersEnabled: false,
      remindersEnabled: false,
      spokiProvider: 'mock',
      smsProvider: 'mock',
      crmProvider: 'mock',
      infinityProvider: 'mock',
      repositoryProvider: 'memory',
      mediaStorageProvider: 'memory',
      mockLatencyMs: 0,
      mockDeliveryDelayMs: 0,
    },
    clock,
    logger: new NoopLogger(),
    store: InMemoryStore.createIsolated(),
    sessionSecret: 's'.repeat(40),
  });
  setContainerForTests(container);
});

afterAll(() => {
  resetContainerForTests();
});

describe('Webhook Spoki: esiti di consegna firmati', () => {
  it('consegnato → letto: job e pratica avanzano e la risposta dice lo stato applicato', async () => {
    const a = await praticaInCarico();
    const job = await benvenutoInviato(a);
    const id = idMessaggio(job);

    const consegnato = await POST(esitoFirmato(id, 'Delivered'));
    expect(consegnato.status).toBe(200);
    expect(await consegnato.json()).toEqual({
      handled: true,
      state: 'DELIVERED',
      status: 'DELIVERED',
    });

    const letto = await POST(esitoFirmato(id, 'Read'));
    expect(await letto.json()).toMatchObject({ handled: true, state: 'READ', status: 'READ' });

    const pratica = await container.repos.appointments.findById(a.id);
    expect(pratica?.whatsapp?.state).toBe('READ');
    expect(pratica?.whatsapp?.kind).toBe('CHECK_IN_STARTED');
    expect(pratica?.version).toBe(a.version);
    expect((await container.repos.notifications.findJobById(job.id))?.status).toBe('READ');
  });

  it('firma sbagliata, timestamp vecchio o assenza di firma → 403; il segreto condiviso è un’alternativa valida', async () => {
    const a = await praticaInCarico();
    const job = await benvenutoInviato(a);
    const id = idMessaggio(job);
    const corpo = JSON.stringify({
      version: 2,
      event: 'message.outbound',
      event_uuid: 'ev-x',
      data: { uuid: id, send_status: 'Delivered' },
    });

    const senzaFirma = await POST(richiesta(corpo));
    expect(senzaFirma.status).toBe(403);
    const firmaErrata = await POST(
      richiesta(corpo, {
        'x-spoki-signature': buildSpokiSignatureHeader(corpo, 'whsec_altro-0123456789abcdef', 1),
      }),
    );
    expect(firmaErrata.status).toBe(403);
    const vecchia = await POST(
      richiesta(corpo, {
        'x-spoki-signature': buildSpokiSignatureHeader(
          corpo,
          SEGRETO_WEBHOOK,
          Math.floor(clock.now().getTime() / 1000) - 3600,
        ),
      }),
    );
    expect(vecchia.status).toBe(403);
    expect((await container.repos.notifications.findJobById(job.id))?.status).toBe('SENT');

    const conSegreto = await POST(richiesta(corpo, { 'x-spoki-secret': SEGRETO_WEBHOOK }));
    expect(conSegreto.status).toBe(200);
    expect((await container.repos.notifications.findJobById(job.id))?.status).toBe('DELIVERED');
  });

  it('un messaggio sconosciuto, un ritento dello stesso evento e un evento non pertinente sono 200 handled:false', async () => {
    const ignoto = await POST(
      esitoFirmato('mai-visto', 'Delivered', { to_phone: '+390000000000' }),
    );
    expect(ignoto.status).toBe(200);
    expect(await ignoto.json()).toEqual({ handled: false, reason: 'UNKNOWN_MESSAGE' });

    const a = await praticaInCarico();
    const job = await benvenutoInviato(a);
    const id = idMessaggio(job);
    await POST(esitoFirmato(id, 'Delivered', {}, 'ev-ripetuto'));
    const ripetuto = await POST(esitoFirmato(id, 'Delivered', {}, 'ev-ripetuto'));
    expect(await ripetuto.json()).toEqual({ handled: false, reason: 'DUPLICATE_EVENT' });

    const corpo = JSON.stringify({ version: 2, event: 'contact.updated', data: { id: 1 } });
    const altro = await POST(richiesta(corpo, { 'x-spoki-secret': SEGRETO_WEBHOOK }));
    expect(await altro.json()).toEqual({
      handled: false,
      reason: 'IGNORED_EVENT',
      event: 'contact.updated',
    });
  });

  it('un corpo che non è JSON o non è un oggetto → 400', async () => {
    expect((await POST(richiesta('non json'))).status).toBe(400);
    expect((await POST(richiesta('[1,2]'))).status).toBe(400);
  });

  it('un evento senza segreto dei webhook configurato → 404, anche se le risposte del cliente restano attive', async () => {
    const senzaWebhook = createContainer({
      env: {
        spokiWebhookSecret: null,
        spokiInboundSecret: SEGRETO_INBOUND,
        messagingStandby: false,
        messagingTriggersEnabled: false,
        remindersEnabled: false,
        spokiProvider: 'mock',
        repositoryProvider: 'memory',
        mediaStorageProvider: 'memory',
        mockLatencyMs: 0,
      },
      clock,
      logger: new NoopLogger(),
      store: InMemoryStore.createIsolated(),
      sessionSecret: 's'.repeat(40),
    });
    setContainerForTests(senzaWebhook);
    try {
      const r = await POST(richiesta({ messageId: 'x', status: 'delivered' }));
      expect(r.status).toBe(404);
      const risposta = await POST(
        richiesta({ phone: '+393330000000', reply: 'Arrivato', secret: SEGRETO_INBOUND }),
      );
      // Numero senza pratica: la rotta è viva e risponde handled:false, non 404.
      expect(risposta.status).toBe(200);
      expect(await risposta.json()).toEqual({ handled: false, reason: 'NOT_FOUND' });
    } finally {
      setContainerForTests(container);
    }
  });
});

describe('Webhook Spoki: risposte del cliente', () => {
  it('la forma piatta con il segreto dell’automazione arriva al servizio delle risposte', async () => {
    const inserita = await container.repos.appointments.insert(
      makeAppointment({
        status: 'WAITING',
        businessDate: clock.today(),
        customer: { ...makeAppointment().customer, phone: '+393331234561' as PhoneE164 },
      }),
    );
    if (!inserita.ok) {
      throw new Error(inserita.error.message);
    }
    const a = inserita.value;
    const r = await POST(
      richiesta({ phone: a.customer.phone, reply: 'Arrivato', secret: SEGRETO_INBOUND }),
    );
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { handled: boolean; code?: string };
    expect(corpo.handled).toBe(true);
    expect(corpo.code).toBe(a.code);
    expect((await container.repos.appointments.findById(a.id))?.customerArrivedAt).not.toBeNull();
    const sbagliato = await POST(
      richiesta({ phone: a.customer.phone, reply: 'Arrivato', secret: 'no' }),
    );
    expect(sbagliato.status).toBe(403);
  });

  it('un message.inbound V2 firmato con il segreto dei webhook segue la stessa strada', async () => {
    const corpo = JSON.stringify({
      version: 2,
      event: 'message.inbound',
      event_uuid: 'in-1',
      data: { uuid: 'm-in', from_phone: '+393339999999', text: 'grazie', payload: null },
    });
    const r = await POST(
      richiesta(corpo, {
        'x-spoki-signature': buildSpokiSignatureHeader(
          corpo,
          SEGRETO_WEBHOOK,
          Math.floor(clock.now().getTime() / 1000),
        ),
      }),
    );
    expect(r.status).toBe(200);
    // Testo non riconosciuto o numero senza pratica: ignorato senza errore.
    expect((await r.json()).handled).toBe(false);
  });
});
