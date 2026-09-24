// Risposte ai pulsanti affidate alle automazioni Spoki (M8-T51-S07): l'automazione risponde al
// cliente anche a server giù e chiama la rotta dal suo passo «webhook» con `source: automation`.
// Qui la rotta registra il fatto, non manda niente di suo e restituisce `esito` e `risposta` (il
// testo che spetta al cliente). Con SPOKI_REPLIES_BY_AUTOMATION=true la stessa tocca che arriva dal
// webhook V2 non fa partire la conferma dall'app; un messaggio scritto a mano sì. Più segreti V2.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST } from '@/app/api/v1/webhooks/spoki/route';
import { createPortalTokenFactory, derivePortalTokenKey } from '@/application/portal/portal-token';
import {
  createContainer,
  resetContainerForTests,
  setContainerForTests,
  type Container,
} from '@/config/container';
import { parseEnv } from '@/config/env';
import type { Appointment } from '@/domain/entities/appointment';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import type { PhoneE164 } from '@/domain/value-objects/phone';
import { buildSpokiSignatureHeader } from '@/lib/http/spoki-signature';
import { InMemoryStore } from '@/repositories/in-memory/InMemoryStore';
import { NoopLogger } from '@/services/mocks/ConsoleLogger';
import { makeAppointment, TestClock } from '../helpers/fixtures';

const SEGRETO_INBOUND = 'inbound-prova-0123456789abcdef0123456789ab';
const SEGRETO_V2_ENTRATA = 'whsec_prova_entrata_0123456789abcdef0001';
const SEGRETO_V2_USCITA = 'whsec_prova_uscita_0123456789abcdef00002';
const SEGRETO_SESSIONE = 'z'.repeat(40);

let container: Container;
let clock: TestClock;

beforeAll(() => {
  // 08:00 UTC = 10:00 a Roma.
  clock = new TestClock('2026-09-10T08:00:00.000Z');
  container = createContainer({
    env: {
      spokiWebhookSecret: SEGRETO_V2_ENTRATA,
      spokiWebhookSecrets: [SEGRETO_V2_ENTRATA, SEGRETO_V2_USCITA],
      spokiInboundSecret: SEGRETO_INBOUND,
      spokiRepliesByAutomation: true,
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
    sessionSecret: SEGRETO_SESSIONE,
  });
  setContainerForTests(container);
});

afterAll(() => {
  resetContainerForTests();
});

function post(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://officina.local/api/v1/webhooks/spoki', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** La chiamata del passo «webhook» dell'automazione, come la descrive docs/SPOKI.md. */
function dallAutomazione(
  phone: string,
  reply: string,
  extra: Record<string, string> = {},
): NextRequest {
  return post(
    { source: 'automation', phone, reply, code: '%%ACC_CODICE%%', ...extra },
    { 'x-spoki-secret': SEGRETO_INBOUND },
  );
}

/** Evento V2 `message.inbound`, firmato con uno dei due segreti. */
function eventoV2(
  phone: string,
  data: { readonly text: string; readonly payload: string | null },
  uuid: string,
  segreto = SEGRETO_V2_ENTRATA,
): NextRequest {
  const corpo = JSON.stringify({
    version: 2,
    event: 'message.inbound',
    event_uuid: uuid,
    timestamp: clock.now().getTime() / 1000,
    data: { uuid: `m-${uuid}`, from_phone: phone, ...data, sent_datetime: clock.nowIso() },
  });
  return post(corpo, {
    'x-spoki-signature': buildSpokiSignatureHeader(
      corpo,
      segreto,
      Math.floor(clock.now().getTime() / 1000),
    ),
  });
}

async function pratica(
  phone: string,
  scheduledAt = '2026-09-10T08:15:00.000Z',
): Promise<Appointment> {
  const r = await container.repos.appointments.insert(
    makeAppointment({
      status: 'WAITING',
      businessDate: clock.today(),
      scheduledAt: scheduledAt as IsoDateTime,
      customer: { ...makeAppointment().customer, phone: phone as PhoneE164 },
    }),
  );
  if (!r.ok) {
    throw new Error(r.error.message);
  }
  return r.value;
}

async function messaggiInviati(a: Appointment): Promise<readonly string[]> {
  return (await container.repos.notifications.listByAppointment(a.id)).map((j) => j.kind);
}

interface Corpo {
  readonly handled: boolean;
  readonly esito?: string;
  readonly risposta?: string;
  readonly replyBy?: string;
  readonly replySent?: boolean;
  readonly premature?: boolean;
}

describe('Automazione Spoki dei pulsanti: la rotta registra e restituisce il testo', () => {
  it('«Sono arrivato»: in fila, esito ARRIVATO, risposta con codice e smart link, nessun invio dall’app', async () => {
    const a = await pratica('+393331240001');
    const r = await POST(dallAutomazione(a.customer.phone ?? '', 'ACTION_ARRIVED'));
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as Corpo;
    expect(corpo).toMatchObject({
      handled: true,
      esito: 'ARRIVATO',
      replyBy: 'SPOKI',
      replySent: false,
    });
    const token = createPortalTokenFactory(derivePortalTokenKey(SEGRETO_SESSIONE)).forAppointment(
      a.id,
    );
    expect(corpo.risposta).toContain(`Sei stato inserito in fila con il codice ${a.code}`);
    expect(corpo.risposta).toContain(`/portal/${token}`);
    expect((await container.repos.appointments.findById(a.id))?.customerArrivedAt).not.toBeNull();
    // La conferma la consegna Spoki: l'app non ha creato nessun messaggio.
    expect(await messaggiInviati(a)).toEqual([]);
  });

  it('la stessa tocca prima dal webhook V2 e poi dall’automazione: un solo arrivo, nessun invio, di nuovo codice e link', async () => {
    const a = await pratica('+393331240002');
    const v2 = await POST(
      eventoV2(a.customer.phone ?? '', { text: 'Sono arrivato', payload: 'ACTION_ARRIVED' }, 'e-1'),
    );
    expect(await v2.json()).toMatchObject({ handled: true, replyBy: 'SPOKI', replySent: false });
    const arrivo = (await container.repos.appointments.findById(a.id))?.customerArrivedAt;
    expect(arrivo).not.toBeNull();

    const auto = await POST(dallAutomazione(a.customer.phone ?? '', 'ACTION_ARRIVED'));
    const corpo = (await auto.json()) as Corpo;
    expect(corpo.esito).toBe('GIA_REGISTRATO');
    expect(corpo.risposta).toContain(a.code);
    expect((await container.repos.appointments.findById(a.id))?.customerArrivedAt).toBe(arrivo);
    expect(await messaggiInviati(a)).toEqual([]);
  });

  it('troppo presto: pratica intatta, esito TROPPO_PRESTO e il testo che dice quando ripremere', async () => {
    // Appuntamento alle 12:00 locali, due ore dopo l'orologio del test.
    const a = await pratica('+393331240003', '2026-09-10T10:00:00.000Z');
    const r = await POST(dallAutomazione(a.customer.phone ?? '', 'ACTION_ARRIVED'));
    const corpo = (await r.json()) as Corpo;
    expect(corpo).toMatchObject({ handled: true, esito: 'TROPPO_PRESTO', premature: true });
    expect(corpo.risposta).toContain('previsto per le 12:00');
    const dopo = await container.repos.appointments.findById(a.id);
    expect(dopo?.customerArrivedAt).toBeNull();
    expect(dopo?.version).toBe(a.version);
    expect(await messaggiInviati(a)).toEqual([]);
  });

  it('«In ritardo» e «Non posso venire»: RITARDO e ASSENTE con i loro testi, anche alla seconda tocca', async () => {
    const tardi = await pratica('+393331240004');
    const r1 = (await (
      await POST(dallAutomazione(tardi.customer.phone ?? '', 'ACTION_LATE'))
    ).json()) as Corpo;
    expect(r1.esito).toBe('RITARDO');
    expect(r1.risposta).toContain("Abbiamo informato l'accettazione del tuo ritardo");
    const r1bis = (await (
      await POST(dallAutomazione(tardi.customer.phone ?? '', 'ACTION_LATE'))
    ).json()) as Corpo;
    expect(r1bis.esito).toBe('RITARDO');
    expect(r1bis.risposta).toContain('ritardo');
    expect(
      (await container.repos.appointments.findById(tardi.id))?.customerLateNoticeAt,
    ).not.toBeNull();

    const assente = await pratica('+393331240005');
    const r2 = (await (
      await POST(dallAutomazione(assente.customer.phone ?? '', 'ACTION_ABSENT'))
    ).json()) as Corpo;
    expect(r2.esito).toBe('ASSENTE');
    expect(r2.risposta).toContain('Abbiamo annullato la prenotazione di oggi');
    expect((await container.repos.appointments.findById(assente.id))?.status).toBe('NO_SHOW');
    const r2bis = (await (
      await POST(dallAutomazione(assente.customer.phone ?? '', 'ACTION_ABSENT'))
    ).json()) as Corpo;
    expect(r2bis.esito).toBe('ASSENTE');
    expect(r2bis.risposta).toContain('Abbiamo annullato');
    expect(await messaggiInviati(tardi)).toEqual([]);
    expect(await messaggiInviati(assente)).toEqual([]);
  });

  it('numero senza pratica: handled false, esito NESSUNA_PRATICA e risposta vuota', async () => {
    const r = await POST(dallAutomazione('+393339990000', 'ACTION_ARRIVED'));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      handled: false,
      reason: 'NOT_FOUND',
      esito: 'NESSUNA_PRATICA',
      risposta: '',
    });
  });

  it('un campo che Spoki non ha riempito vale come assente; senza il segreto giusto → 403', async () => {
    const senzaNumero = await POST(
      post(
        { source: 'automation', phone: '{{ contact.phone }}', reply: 'ACTION_LATE' },
        { 'x-spoki-secret': SEGRETO_INBOUND },
      ),
    );
    expect(senzaNumero.status).toBe(400);
    const segretoSbagliato = await POST(
      post(
        { source: 'automation', phone: '+393331240006', reply: 'ACTION_LATE' },
        { 'x-spoki-secret': 'non-questo' },
      ),
    );
    expect(segretoSbagliato.status).toBe(403);
  });
});

describe('SPOKI_REPLIES_BY_AUTOMATION: il webhook V2 non raddoppia la conferma', () => {
  it('il testo scritto a mano (nessun pulsante) resta all’app, che risponde come prima', async () => {
    const a = await pratica('+393331240007');
    const r = await POST(
      eventoV2(a.customer.phone ?? '', { text: 'sono in ritardo', payload: null }, 'e-2'),
    );
    expect(await r.json()).toMatchObject({ handled: true, replyBy: 'APP', replySent: true });
    expect(await messaggiInviati(a)).toEqual(['LATE_CONFIRMED']);
  });

  it('un evento firmato con il secondo segreto V2 è accettato', async () => {
    const a = await pratica('+393331240008');
    const r = await POST(
      eventoV2(
        a.customer.phone ?? '',
        { text: 'In ritardo', payload: 'ACTION_LATE' },
        'e-3',
        SEGRETO_V2_USCITA,
      ),
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ handled: true, reply: 'LATE', replyBy: 'SPOKI' });
  });
});

describe('Ambiente: segreti V2 e risposte affidate a Spoki', () => {
  const muto = () => undefined;

  it('SPOKI_WEBHOOK_SECRET accetta più segreti separati da virgola; quelli corti si scartano', () => {
    const avvisi: string[] = [];
    const env = parseEnv(
      {
        SPOKI_WEBHOOK_SECRET: `${SEGRETO_V2_ENTRATA}, corto ,${SEGRETO_V2_USCITA},${SEGRETO_V2_ENTRATA}`,
      },
      (m) => avvisi.push(m),
    );
    expect(env.spokiWebhookSecrets).toEqual([SEGRETO_V2_ENTRATA, SEGRETO_V2_USCITA]);
    expect(env.spokiWebhookSecret).toBe(SEGRETO_V2_ENTRATA);
    expect(avvisi.some((m) => m.includes('troppo corto'))).toBe(true);
    expect(parseEnv({}, muto).spokiWebhookSecrets).toEqual([]);
    expect(parseEnv({}, muto).spokiWebhookSecret).toBeNull();
  });

  it('SPOKI_REPLIES_BY_AUTOMATION è spento di default', () => {
    expect(parseEnv({}, muto).spokiRepliesByAutomation).toBe(false);
    expect(parseEnv({ SPOKI_REPLIES_BY_AUTOMATION: 'true' }, muto).spokiRepliesByAutomation).toBe(
      true,
    );
  });
});
