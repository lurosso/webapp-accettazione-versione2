import { describe, expect, it } from 'vitest';
import type { PhoneE164 } from '@/domain/value-objects/phone';
import type { SpokiSendRequestDto } from '@/services/dto/spoki.dto';
import { NoopLogger } from '@/services/mocks/ConsoleLogger';
import { SequentialIdGenerator } from '@/services/mocks/SequentialIdGenerator';
import {
  SpokiActivityLog,
  SpokiService,
  buildWebhookPayload,
  type SpokiServiceConfig,
} from '@/infrastructure/messaging/spoki';
import { TestClock } from '../helpers/fixtures';

const URLS = {
  CONFIRMATION: 'https://hooks.spoki.example/aut/conferma',
  TURN_APPROACHING: 'https://hooks.spoki.example/aut/turno',
  CANCELLATION: 'https://hooks.spoki.example/aut/annullo',
} as const;

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
    apiKey: null,
    urls: { CONFIRMATION: null, TURN_APPROACHING: null, CANCELLATION: null },
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

const richiesta = (overrides: Partial<SpokiSendRequestDto> = {}): SpokiSendRequestDto => ({
  idempotencyKey: 'app-1:BOOKING_CONFIRMED:2026-09-10:WA:1',
  to: '+393331234567' as PhoneE164,
  templateKey: 'booking_confirmed_v1',
  variables: {
    firstName: 'Mario',
    code: 'F012',
    plate: 'AB123CD',
    scheduledTime: '09:30',
    brandName: 'Fiat',
    portalUrl: 'https://officina.example/portal?targa=AB123CD',
    text: 'Mario, la sua pratica…',
  },
  correlationId: 'corr-1',
  ...overrides,
});

describe('SpokiService in simulazione', () => {
  it('non chiama la rete, risponde 200 e scrive il payload nel registro', async () => {
    const rete = fakeFetch(() => new Response('{}', { status: 200 }));
    const { service, activityLog } = setup({}, rete.impl);

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
    expect(voce?.templateKind).toBe('CONFIRMATION');
    expect(voce?.templateKey).toBe('booking_confirmed_v1');
    expect(voce?.phoneMasked).toBe('*********4567');
    expect(voce?.outcome).toEqual({
      ok: true,
      httpStatus: 200,
      messageId: r.value.providerMessageId,
      error: null,
    });
    expect(voce?.payload).toMatchObject({
      phone: '+393331234567',
      first_name: 'Mario',
      code: 'F012',
      plate: 'AB123CD',
      portal_url: 'https://officina.example/portal?targa=AB123CD',
      template: 'booking_confirmed_v1',
    });
    // Nel registro non compare mai il numero in chiaro fuori dal payload.
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
    const r = await service.sendTemplateMessage(richiesta({ templateKey: 'reminder_morning_v1' }));
    expect(!r.ok && r.error.code).toBe('INVALID_REQUEST');
    expect(!r.ok && r.error.retryable).toBe(false);
    expect(activityLog.list()).toHaveLength(0);
  });

  it('lo stato di salute dice che è simulazione e che nessuna chiamata parte', async () => {
    const { service } = setup();
    const h = await service.healthCheck();
    expect(h.status).toBe('UP');
    expect(h.implementation).toBe('real');
    expect(h.detail).toContain('simulazione');
  });

  it('il payload piatto riporta le variabili del template in snake_case', () => {
    const p = buildWebhookPayload(richiesta());
    expect(p).toEqual({
      phone: '+393331234567',
      first_name: 'Mario',
      code: 'F012',
      plate: 'AB123CD',
      scheduled_time: '09:30',
      brand: 'Fiat',
      portal_url: 'https://officina.example/portal?targa=AB123CD',
      text: 'Mario, la sua pratica…',
      template: 'booking_confirmed_v1',
      correlation_id: 'corr-1',
      idempotency_key: 'app-1:BOOKING_CONFIRMED:2026-09-10:WA:1',
    });
  });
});

describe('SpokiService live', () => {
  it("chiama l'URL del template con la chiave nell'intestazione e il payload JSON", async () => {
    const rete = fakeFetch(() => new Response(JSON.stringify({ id: 'wa-42' }), { status: 200 }));
    const { service, activityLog } = setup(
      { mode: 'live', apiKey: 'chiave-segreta', urls: URLS },
      rete.impl,
    );

    const r = await service.sendTemplateMessage(richiesta({ templateKey: 'turn_approaching_v1' }));
    expect(r.ok && r.value.providerMessageId).toBe('wa-42');
    expect(rete.calls).toHaveLength(1);
    const chiamata = rete.calls[0];
    expect(chiamata?.url).toBe(URLS.TURN_APPROACHING);
    expect(chiamata?.init.method).toBe('POST');
    const headers = chiamata?.init.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer chiave-segreta');
    expect(headers['content-type']).toBe('application/json');
    const body = JSON.parse(String(chiamata?.init.body)) as Record<string, unknown>;
    expect(body['phone']).toBe('+393331234567');
    expect(body['code']).toBe('F012');
    expect(body['portal_url']).toBe('https://officina.example/portal?targa=AB123CD');
    // In live la consegna non è nota finché Spoki non lo dice: resta SENT.
    const stato = await service.getDeliveryStatus('wa-42');
    expect(stato.ok && stato.value.state).toBe('SENT');
    expect(activityLog.list()[0]?.mode).toBe('live');
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
      const { service } = setup({ mode: 'live', apiKey: 'k', urls: URLS }, rete.impl);
      const r = await service.sendTemplateMessage(richiesta({ idempotencyKey: `k-${status}` }));
      expect(!r.ok && r.error.code).toBe(code);
      expect(!r.ok && r.error.retryable).toBe(retryable);
    }
  });

  it('senza URL o senza chiave non chiama nulla e non ritenta', async () => {
    const rete = fakeFetch(() => new Response('{}', { status: 200 }));
    const senzaUrl = setup({ mode: 'live', apiKey: 'k' }, rete.impl);
    const r1 = await senzaUrl.service.sendTemplateMessage(richiesta());
    expect(!r1.ok && r1.error.code).toBe('INVALID_REQUEST');

    const senzaChiave = setup({ mode: 'live', apiKey: null, urls: URLS }, rete.impl);
    const r2 = await senzaChiave.service.sendTemplateMessage(richiesta());
    expect(!r2.ok && r2.error.code).toBe('AUTH');
    expect(rete.calls).toHaveLength(0);
    // Anche i fallimenti restano nel registro, con il motivo.
    expect(senzaChiave.activityLog.list()[0]?.outcome.ok).toBe(false);
  });

  it('un errore di rete è ritentabile', async () => {
    const { service } = setup({ mode: 'live', apiKey: 'k', urls: URLS }, async () => {
      throw new Error('ECONNREFUSED');
    });
    const r = await service.sendTemplateMessage(richiesta());
    expect(!r.ok && r.error.code).toBe('NETWORK');
    expect(!r.ok && r.error.retryable).toBe(true);
  });

  it('lo stato di salute segnala la configurazione incompleta', async () => {
    const { service } = setup({
      mode: 'live',
      apiKey: null,
      urls: { ...URLS, CANCELLATION: null },
    });
    const h = await service.healthCheck();
    expect(h.status).toBe('DEGRADED');
    expect(h.detail).toContain('SPOKI_API_KEY');
    expect(h.detail).toContain('CANCELLATION');
  });

  it('il webhook di esito aggiorna lo stato di consegna', () => {
    const { service } = setup({ mode: 'live', apiKey: 'k', urls: URLS });
    const r = service.parseWebhook({ message_id: 'wa-1', status: 'delivered' }, {});
    expect(r.ok && r.value.state).toBe('DELIVERED');
    expect(service.parseWebhook({ status: 'x' }, {}).ok).toBe(false);
  });
});
