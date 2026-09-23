import { describe, expect, it } from 'vitest';
import type { PhoneE164 } from '@/domain/value-objects/phone';
import type { SpokiSendRequestDto } from '@/services/dto/spoki.dto';
import { NoopLogger } from '@/services/mocks/ConsoleLogger';
import { SequentialIdGenerator } from '@/services/mocks/SequentialIdGenerator';
import {
  SpokiActivityLog,
  SpokiService,
  buildTemplateSendPayload,
  buildWebhookPayload,
  canDeliverLive,
  deliveryBlockReason,
  maskSecret,
  type SpokiServiceConfig,
  type SpokiTemplateKind,
} from '@/infrastructure/messaging/spoki';
import { TestClock } from '../helpers/fixtures';

const NESSUNO: Readonly<Record<SpokiTemplateKind, null>> = {
  REMINDER_PREVIOUS_DAY: null,
  REMINDER_SAME_DAY: null,
  ARRIVAL_CONFIRMED: null,
  LATE_CONFIRMED: null,
  ABSENT_CONFIRMED: null,
  CHECK_IN_STARTED: null,
  CHECK_IN_COMPLETED: null,
  CONFIRMATION: null,
  TURN_APPROACHING: null,
  CANCELLATION: null,
};

/** Id dei template dei due messaggi del check-in (invio via API). */
const TEMPLATES: Readonly<Record<SpokiTemplateKind, string | null>> = {
  ...NESSUNO,
  CHECK_IN_STARTED: '3068',
  CHECK_IN_COMPLETED: '3069',
};

const URLS: Readonly<Record<SpokiTemplateKind, string | null>> = {
  ...NESSUNO,
  REMINDER_PREVIOUS_DAY: 'https://api.spoki.example/wh/ap/prev-0001/',
  REMINDER_SAME_DAY: 'https://api.spoki.example/wh/ap/same-0002/',
};

const SECRETS: Readonly<Record<SpokiTemplateKind, string | null>> = {
  ...NESSUNO,
  REMINDER_PREVIOUS_DAY: 'segreto-giorno-prima-0123456789abcdef',
  REMINDER_SAME_DAY: 'segreto-giorno-stesso-0123456789abcdef',
};

interface FetchCall {
  readonly url: string;
  readonly init: RequestInit;
}

/** fetch finto: registra le chiamate e risponde come deciso dal test. */
function fakeFetch(responder: (call: FetchCall) => Response) {
  const calls: FetchCall[] = [];
  const impl = async (url: string, init: RequestInit): Promise<Response> => {
    const call = { url, init };
    calls.push(call);
    return responder(call);
  };
  return { calls, impl };
}

function setup(
  overrides: Partial<SpokiServiceConfig> = {},
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>,
) {
  const clock = new TestClock();
  const ids = new SequentialIdGenerator('s');
  const activityLog = new SpokiActivityLog(ids, 50);
  const config: SpokiServiceConfig = {
    mode: 'simulation',
    safetyLock: true,
    apiKey: null,
    apiBaseUrl: 'https://api.spoki.example',
    urls: NESSUNO,
    secrets: NESSUNO,
    templates: NESSUNO,
    timeoutMs: 1000,
    ...overrides,
  };
  const service = new SpokiService(config, {
    clock,
    ids,
    logger: new NoopLogger(),
    activityLog,
    fetchImpl,
  });
  return { service, activityLog, clock };
}

/** Configurazione che PUÒ inviare davvero: live, blocco tolto, URL e segreti presenti. */
const LIVE_SBLOCCATO: Partial<SpokiServiceConfig> = {
  mode: 'live',
  safetyLock: false,
  apiKey: 'chiave-segreta',
  urls: URLS,
  secrets: SECRETS,
  templates: TEMPLATES,
};

const richiesta = (overrides: Partial<SpokiSendRequestDto> = {}): SpokiSendRequestDto => ({
  idempotencyKey: 'app-1:REMINDER_SAME_DAY:2026-09-11:WA:1',
  to: '+393331234567' as PhoneE164,
  templateKey: 'reminder_same_day_v1',
  variables: {
    firstName: 'Mario',
    lastName: 'Rossi',
    email: '',
    code: 'F012',
    plate: 'AB123CD',
    scheduledTime: '09:30',
    scheduledDate: '11/09/2026',
    brandName: 'Fiat',
    portalUrl: 'https://officina.example/portal?targa=AB123CD',
    text: 'Buongiorno Mario, le ricordiamo…',
  },
  correlationId: 'corr-1',
  ...overrides,
});

describe('Guardrail Spoki: quando una chiamata reale è ammessa', () => {
  it('solo con modalità live E blocco di sicurezza tolto', () => {
    expect(canDeliverLive('live', false)).toBe(true);
    expect(canDeliverLive('live', true)).toBe(false);
    expect(canDeliverLive('simulation', false)).toBe(false);
    expect(canDeliverLive('simulation', true)).toBe(false);
    expect(deliveryBlockReason('simulation', true)).toBe('SIMULATION');
    expect(deliveryBlockReason('simulation', false)).toBe('SIMULATION');
    expect(deliveryBlockReason('live', true)).toBe('SAFETY_LOCK');
    expect(deliveryBlockReason('live', false)).toBeNull();
  });

  it('il segreto mascherato non rivela il valore', () => {
    expect(maskSecret('')).toBe('');
    expect(maskSecret('corto')).toBe('••••');
    const m = maskSecret('159256ac34c34a318ee0ee930daae247');
    expect(m).toBe('1592••••e247');
    expect(m).not.toContain('ac34c34a');
  });
});

describe('SpokiService in simulazione (blocco predefinito)', () => {
  it('non chiama la rete, risponde 200 e scrive il payload nel registro con il motivo del blocco', async () => {
    const rete = fakeFetch(() => new Response('{}', { status: 200 }));
    const { service, activityLog } = setup({ urls: URLS, secrets: SECRETS }, rete.impl);

    const r = await service.sendTemplateMessage(richiesta());
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.value.providerMessageId.startsWith('sim-')).toBe(true);
    expect(rete.calls).toHaveLength(0);

    const voci = activityLog.list();
    expect(voci).toHaveLength(1);
    const voce = voci[0];
    expect(voce?.mode).toBe('simulation');
    expect(voce?.blockedBy).toBe('SIMULATION');
    expect(voce?.templateKind).toBe('REMINDER_SAME_DAY');
    expect(voce?.templateKey).toBe('reminder_same_day_v1');
    expect(voce?.phoneMasked).toBe('*********4567');
    expect(voce?.url).toBe(URLS.REMINDER_SAME_DAY);
    expect(voce?.outcome).toEqual({
      ok: true,
      httpStatus: 200,
      messageId: r.value.providerMessageId,
      error: null,
    });
    expect(voce?.payload).toMatchObject({
      phone: '+393331234567',
      first_name: 'Mario',
      last_name: 'Rossi',
      custom_fields: {
        code: 'F012',
        plate: 'AB123CD',
        time: '09:30',
        date: '11/09/2026',
        portal_url: 'https://officina.example/portal?targa=AB123CD',
      },
    });
    // Nel registro il segreto è mascherato e il numero non compare fuori dal payload.
    expect(voce?.payload['secret']).toBe(maskSecret(SECRETS.REMINDER_SAME_DAY ?? ''));
    expect(JSON.stringify(voce)).not.toContain(SECRETS.REMINDER_SAME_DAY);
    expect(JSON.stringify({ ...voce, payload: undefined })).not.toContain('+393331234567');
  });

  it('il messaggio simulato risulta consegnato: nessun ripiego SMS', async () => {
    const { service } = setup();
    const r = await service.sendTemplateMessage(richiesta());
    if (!r.ok) {
      throw new Error('invio fallito');
    }
    const stato = await service.getDeliveryStatus(r.value.providerMessageId);
    expect(stato.ok && stato.value.state).toBe('DELIVERED');
  });

  it('è idempotente: stessa chiave, stessa ricevuta, nessuna nuova voce', async () => {
    const { service, activityLog } = setup();
    const prima = await service.sendTemplateMessage(richiesta());
    const seconda = await service.sendTemplateMessage(richiesta());
    expect(prima.ok && seconda.ok && prima.value.providerMessageId).toBe(
      seconda.ok ? seconda.value.providerMessageId : null,
    );
    expect(activityLog.list()).toHaveLength(1);
  });

  it("un template senza automazione Spoki è rifiutato senza retry: si passa all'SMS", async () => {
    const { service, activityLog } = setup();
    const r = await service.sendTemplateMessage(richiesta({ templateKey: 'your_turn_v1' }));
    expect(!r.ok && r.error.code).toBe('INVALID_REQUEST');
    expect(!r.ok && r.error.retryable).toBe(false);
    expect(activityLog.list()).toHaveLength(0);
  });

  it('lo stato di salute dice che è simulazione e segnala la configurazione mancante di promemoria e template', async () => {
    const { service } = setup();
    const h = await service.healthCheck();
    expect(h.status).toBe('UP');
    expect(h.implementation).toBe('real');
    expect(h.detail).toContain('simulazione');
    expect(h.detail).toContain('REMINDER_PREVIOUS_DAY');
    expect(h.detail).toContain('CHECK_IN_STARTED (SPOKI_TEMPLATE_WELCOME_ID)');
    expect(h.detail).toContain('chiave API assente');
    expect(service.liveDeliveryAllowed).toBe(false);
  });

  it('un messaggio del check-in in simulazione finisce nel registro come template via API, con i metadati tecnici', async () => {
    const rete = fakeFetch(() => new Response('{}', { status: 200 }));
    const { service, activityLog } = setup({ templates: TEMPLATES }, rete.impl);
    const r = await service.sendTemplateMessage(
      richiesta({
        templateKey: 'check_in_started_v1',
        idempotencyKey: 'app-1:CHECK_IN_STARTED:2026-09-11:WA:1',
      }),
    );
    expect(r.ok).toBe(true);
    expect(rete.calls).toHaveLength(0);
    const voce = activityLog.list()[0];
    expect(voce?.templateKind).toBe('CHECK_IN_STARTED');
    expect(voce?.url).toBe('https://api.spoki.example/api/1/messages/send/ · template 3068');
    expect(voce?.payload).toMatchObject({
      type: 'Template',
      template: 3068,
      language: 'IT',
      phone: '+393331234567',
      custom_fields: { code: 'F012', portal_url: 'https://officina.example/portal?targa=AB123CD' },
      metadata: {
        idempotency_key: 'app-1:CHECK_IN_STARTED:2026-09-11:WA:1',
        template_kind: 'CHECK_IN_STARTED',
        correlation_id: 'corr-1',
      },
    });
    expect(voce?.payload['secret']).toBeUndefined();
  });

  it('il payload del template via API porta numero, nome, campi dinamici e metadati senza dati personali', () => {
    const p = buildTemplateSendPayload(richiesta(), 'CHECK_IN_COMPLETED', '3069');
    expect(p).toEqual({
      type: 'Template',
      phone: '+393331234567',
      template: 3069,
      language: 'IT',
      first_name: 'Mario',
      last_name: 'Rossi',
      email: '',
      custom_fields: {
        code: 'F012',
        plate: 'AB123CD',
        time: '09:30',
        date: '11/09/2026',
        portal_url: 'https://officina.example/portal?targa=AB123CD',
      },
      metadata: {
        idempotency_key: 'app-1:REMINDER_SAME_DAY:2026-09-11:WA:1',
        template_kind: 'CHECK_IN_COMPLETED',
        correlation_id: 'corr-1',
      },
    });
    expect(JSON.stringify(p.metadata)).not.toContain('+39333');
    expect(JSON.stringify(p.metadata)).not.toContain('Mario');
    // Un id non numerico resta stringa; senza id resta vuoto (in live l'adapter lo rifiuta).
    expect(buildTemplateSendPayload(richiesta(), 'CHECK_IN_STARTED', 'abc-1').template).toBe(
      'abc-1',
    );
    expect(buildTemplateSendPayload(richiesta(), 'CHECK_IN_STARTED', null).template).toBe('');
  });

  it('il payload segue il formato Spoki: secret, phone E.164, nome, cognome, e-mail e custom_fields', () => {
    const p = buildWebhookPayload(richiesta(), 'segreto-x');
    expect(p).toEqual({
      secret: 'segreto-x',
      phone: '+393331234567',
      first_name: 'Mario',
      last_name: 'Rossi',
      email: '',
      custom_fields: {
        code: 'F012',
        plate: 'AB123CD',
        time: '09:30',
        date: '11/09/2026',
        portal_url: 'https://officina.example/portal?targa=AB123CD',
      },
    });
    expect(buildWebhookPayload(richiesta(), null).secret).toBe('');
  });
});

describe('SpokiService in live con SAFETY LOCK attivo', () => {
  it('NON chiama la rete anche se tutto è configurato: registra e risponde 200', async () => {
    const rete = fakeFetch(() => new Response('{}', { status: 200 }));
    const { service, activityLog } = setup({ ...LIVE_SBLOCCATO, safetyLock: true }, rete.impl);
    const r = await service.sendTemplateMessage(richiesta());
    expect(r.ok).toBe(true);
    expect(rete.calls).toHaveLength(0);
    const voce = activityLog.list()[0];
    expect(voce?.mode).toBe('live');
    expect(voce?.blockedBy).toBe('SAFETY_LOCK');
    expect(voce?.outcome.ok).toBe(true);
    expect(service.liveDeliveryAllowed).toBe(false);
    const h = await service.healthCheck();
    expect(h.status).toBe('UP');
    expect(h.detail).toContain('BLOCCATO');
    // Consegna simulata: il flusso "consegnato → nessun SMS" resta provabile.
    const stato = await service.getDeliveryStatus(r.ok ? r.value.providerMessageId : '');
    expect(stato.ok && stato.value.state).toBe('DELIVERED');
  });
});

describe('SpokiService live con blocco tolto', () => {
  it("chiama l'URL dell'automazione con il segreto nel payload e la chiave nell'intestazione", async () => {
    const rete = fakeFetch(() => new Response(JSON.stringify({ id: 'wa-42' }), { status: 200 }));
    const { service, activityLog } = setup(LIVE_SBLOCCATO, rete.impl);

    const r = await service.sendTemplateMessage(
      richiesta({ templateKey: 'reminder_previous_day_v1' }),
    );
    expect(r.ok && r.value.providerMessageId).toBe('wa-42');
    expect(rete.calls).toHaveLength(1);
    const chiamata = rete.calls[0];
    expect(chiamata?.url).toBe(URLS.REMINDER_PREVIOUS_DAY);
    expect(chiamata?.init.method).toBe('POST');
    const headers = chiamata?.init.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer chiave-segreta');
    expect(headers['content-type']).toBe('application/json');
    const body = JSON.parse(String(chiamata?.init.body)) as Record<string, unknown>;
    expect(body['secret']).toBe(SECRETS.REMINDER_PREVIOUS_DAY);
    expect(body['phone']).toBe('+393331234567');
    expect(body['custom_fields']).toEqual({
      code: 'F012',
      plate: 'AB123CD',
      time: '09:30',
      date: '11/09/2026',
      portal_url: 'https://officina.example/portal?targa=AB123CD',
    });
    // In live la consegna non è nota finché Spoki non lo dice: resta SENT.
    const stato = await service.getDeliveryStatus('wa-42');
    expect(stato.ok && stato.value.state).toBe('SENT');
    const voce = activityLog.list()[0];
    expect(voce?.mode).toBe('live');
    expect(voce?.blockedBy).toBeNull();
    // Il registro non contiene mai il segreto in chiaro.
    expect(JSON.stringify(voce)).not.toContain(SECRETS.REMINDER_PREVIOUS_DAY);
  });

  it("un template via API va a /api/1/messages/send/ con la chiave nell'intestazione X-Spoki-Api-Key", async () => {
    const rete = fakeFetch(
      () => new Response(JSON.stringify({ message: { uuid: 'msg-777' } }), { status: 202 }),
    );
    const { service, activityLog } = setup(LIVE_SBLOCCATO, rete.impl);
    const r = await service.sendTemplateMessage(
      richiesta({ templateKey: 'check_in_completed_v1', idempotencyKey: 'k-api' }),
    );
    expect(r.ok && r.value.providerMessageId).toBe('msg-777');
    const chiamata = rete.calls[0];
    expect(chiamata?.url).toBe('https://api.spoki.example/api/1/messages/send/');
    const headers = chiamata?.init.headers as Record<string, string>;
    expect(headers['x-spoki-api-key']).toBe('chiave-segreta');
    expect(headers['authorization']).toBeUndefined();
    const body = JSON.parse(String(chiamata?.init.body)) as Record<string, unknown>;
    expect(body['type']).toBe('Template');
    expect(body['template']).toBe(3069);
    expect(body['secret']).toBeUndefined();
    // 202 Accepted è un esito buono: in live la consegna resta SENT finché il webhook non parla.
    const stato = await service.getDeliveryStatus('msg-777');
    expect(stato.ok && stato.value.state).toBe('SENT');
    expect(activityLog.list()[0]?.outcome.httpStatus).toBe(202);
  });

  it('senza id del template o senza chiave API il template via API non parte e non ritenta', async () => {
    const rete = fakeFetch(() => new Response('{}', { status: 200 }));
    const senzaId = setup({ ...LIVE_SBLOCCATO, templates: NESSUNO }, rete.impl);
    const r1 = await senzaId.service.sendTemplateMessage(
      richiesta({ templateKey: 'check_in_started_v1' }),
    );
    expect(!r1.ok && r1.error.code).toBe('INVALID_REQUEST');
    expect(!r1.ok && r1.error.message).toContain('SPOKI_TEMPLATE_*_ID');

    const senzaChiave = setup({ ...LIVE_SBLOCCATO, apiKey: null }, rete.impl);
    const r2 = await senzaChiave.service.sendTemplateMessage(
      richiesta({ templateKey: 'check_in_started_v1' }),
    );
    expect(!r2.ok && r2.error.code).toBe('AUTH');
    expect(rete.calls).toHaveLength(0);
  });

  it('senza chiave API la chiamata parte comunque: autentica il segreto nel payload', async () => {
    const rete = fakeFetch(() => new Response('{}', { status: 200 }));
    const { service } = setup({ ...LIVE_SBLOCCATO, apiKey: null }, rete.impl);
    const r = await service.sendTemplateMessage(richiesta());
    expect(r.ok).toBe(true);
    const headers = rete.calls[0]?.init.headers as Record<string, string>;
    expect(headers['authorization']).toBeUndefined();
  });

  it('errori 5xx e 429 sono ritentabili, 401 e 4xx no', async () => {
    for (const [status, code, retryable] of [
      [500, 'PROVIDER_ERROR', true],
      [429, 'RATE_LIMIT', true],
      [401, 'AUTH', false],
      [422, 'INVALID_REQUEST', false],
      [404, 'NOT_FOUND', false],
    ] as const) {
      const rete = fakeFetch(() => new Response('no', { status }));
      const { service } = setup(LIVE_SBLOCCATO, rete.impl);
      const r = await service.sendTemplateMessage(richiesta({ idempotencyKey: `k-${status}` }));
      expect(!r.ok && r.error.code).toBe(code);
      expect(!r.ok && r.error.retryable).toBe(retryable);
    }
  });

  it('senza URL o senza segreto non chiama nulla e non ritenta', async () => {
    const rete = fakeFetch(() => new Response('{}', { status: 200 }));
    const senzaUrl = setup({ ...LIVE_SBLOCCATO, urls: NESSUNO }, rete.impl);
    const r1 = await senzaUrl.service.sendTemplateMessage(richiesta());
    expect(!r1.ok && r1.error.code).toBe('INVALID_REQUEST');

    const senzaSegreto = setup({ ...LIVE_SBLOCCATO, secrets: NESSUNO }, rete.impl);
    const r2 = await senzaSegreto.service.sendTemplateMessage(richiesta());
    expect(!r2.ok && r2.error.code).toBe('AUTH');
    expect(rete.calls).toHaveLength(0);
    // Anche i fallimenti restano nel registro, con il motivo.
    expect(senzaSegreto.activityLog.list()[0]?.outcome.ok).toBe(false);
  });

  it('un errore di rete è ritentabile', async () => {
    const { service } = setup(LIVE_SBLOCCATO, async () => {
      throw new Error('ECONNREFUSED');
    });
    const r = await service.sendTemplateMessage(richiesta());
    expect(!r.ok && r.error.code).toBe('NETWORK');
    expect(!r.ok && r.error.retryable).toBe(true);
  });

  it('lo stato di salute segnala la configurazione incompleta dei promemoria', async () => {
    const { service } = setup({
      ...LIVE_SBLOCCATO,
      urls: { ...URLS, REMINDER_SAME_DAY: null },
      secrets: { ...SECRETS, REMINDER_PREVIOUS_DAY: null },
    });
    const h = await service.healthCheck();
    expect(h.status).toBe('DEGRADED');
    // Senza URL il promemoria del giorno stesso ricade sul template via API, che qui non ha id.
    expect(h.detail).toContain('REMINDER_SAME_DAY (SPOKI_TEMPLATE_SAME_DAY_ID)');
    expect(h.detail).toContain('REMINDER_PREVIOUS_DAY (segreto)');
    expect(service.liveDeliveryAllowed).toBe(true);
  });

  it('il webhook di esito (piatto o V2) aggiorna lo stato di consegna noto', async () => {
    const { service } = setup(LIVE_SBLOCCATO);
    const r = service.parseWebhook({ message_id: 'wa-1', status: 'delivered' }, {});
    expect(r.ok && r.value.kind === 'DELIVERY' && r.value.state).toBe('DELIVERED');
    expect((await service.getDeliveryStatus('wa-1')).ok).toBe(true);
    const v2 = service.parseWebhook(
      {
        version: 2,
        event: 'message.outbound',
        event_uuid: 'e-1',
        data: { uuid: 'wa-2', send_status: 'Read', to_phone: '+393331234567' },
      },
      {},
    );
    expect(v2.ok && v2.value.kind === 'DELIVERY' && v2.value.state).toBe('READ');
    expect(service.parseWebhook({ status: 'x' }, {}).ok).toBe(false);
  });

  it('elenca i template con trasporto, configurazione e se sono integrati', () => {
    const { service } = setup(LIVE_SBLOCCATO);
    const t = service.templates();
    expect(t.filter((x) => x.active).map((x) => x.kind)).toEqual([
      'REMINDER_PREVIOUS_DAY',
      'REMINDER_SAME_DAY',
      'ARRIVAL_CONFIRMED',
      'LATE_CONFIRMED',
      'ABSENT_CONFIRMED',
      'CHECK_IN_STARTED',
      'CHECK_IN_COMPLETED',
    ]);
    expect(t.find((x) => x.kind === 'CONFIRMATION')?.secretConfigured).toBe(false);
    const benvenuto = t.find((x) => x.kind === 'CHECK_IN_STARTED');
    expect(benvenuto?.transport).toBe('TEMPLATE');
    expect(benvenuto?.templateEnvKey).toBe('SPOKI_TEMPLATE_WELCOME_ID');
    expect(benvenuto?.configured).toBe(true);
    expect(t.find((x) => x.kind === 'REMINDER_SAME_DAY')?.transport).toBe('AUTOMATION');
  });

  describe('Pulsanti rapidi e scelta del trasporto', () => {
    it('il promemoria del giorno stesso via API porta i tre pulsanti con i payload ACTION_*', () => {
      const p = buildTemplateSendPayload(
        richiesta({ templateKey: 'reminder_same_day_v1' }),
        'REMINDER_SAME_DAY',
        '4001',
      );
      expect(p.buttons).toEqual([
        { order: 0, payload: 'ACTION_ARRIVED' },
        { order: 1, payload: 'ACTION_LATE' },
        { order: 2, payload: 'ACTION_ABSENT' },
      ]);
      // Gli altri template non hanno pulsanti: la chiave non compare nemmeno.
      expect(
        'buttons' in buildTemplateSendPayload(richiesta(), 'REMINDER_PREVIOUS_DAY', '4000'),
      ).toBe(false);
    });

    it("l'id del template vince sull'automazione; senza id il promemoria resta sull'automazione; le risposte sono via API", async () => {
      const rete = fakeFetch(() => new Response('{}', { status: 202 }));
      const { service } = setup(
        { ...LIVE_SBLOCCATO, templates: { ...TEMPLATES, REMINDER_PREVIOUS_DAY: '4000' } },
        rete.impl,
      );
      const t = service.templates();
      expect(t.find((x) => x.kind === 'REMINDER_PREVIOUS_DAY')?.transport).toBe('TEMPLATE');
      expect(t.find((x) => x.kind === 'REMINDER_SAME_DAY')?.transport).toBe('AUTOMATION');
      expect(t.find((x) => x.kind === 'ARRIVAL_CONFIRMED')?.transport).toBe('TEMPLATE');
      expect(t.find((x) => x.kind === 'ARRIVAL_CONFIRMED')?.templateEnvKey).toBe(
        'SPOKI_TEMPLATE_ARRIVED_REPLY_ID',
      );
      expect(t.find((x) => x.kind === 'ARRIVAL_CONFIRMED')?.configured).toBe(false);

      await service.sendTemplateMessage(
        richiesta({ templateKey: 'reminder_previous_day_v1', idempotencyKey: 'k-d1' }),
      );
      expect(rete.calls[0]?.url).toBe('https://api.spoki.example/api/1/messages/send/');
      await service.sendTemplateMessage(
        richiesta({ templateKey: 'reminder_same_day_v1', idempotencyKey: 'k-same' }),
      );
      expect(rete.calls[1]?.url).toBe(URLS.REMINDER_SAME_DAY);
    });
  });
});
