// Tocchi sui pulsanti del mattino letti da Spoki, senza https (M8-T55). Le automazioni dei pulsanti
// scrivono ACC_PULSANTE sul contatto; l'app lo legge a intervalli (SpokiReplyPoller), applica il
// tocco alla pratica come il webhook e rimette il campo ad ATTESA. Qui: la lettura del contatto
// nell'adapter con i suoi blocchi, i campi che il promemoria del mattino scrive, il servizio di
// lettura e la configurazione.
import { describe, expect, it } from 'vitest';
import { CustomerPortalService } from '@/application/portal/CustomerPortalService';
import { QueueService } from '@/application/queue/QueueService';
import { SpokiReplyPoller } from '@/application/notifications/SpokiReplyPoller';
import { WhatsAppInboundService } from '@/application/notifications/WhatsAppInboundService';
import { parseEnv } from '@/config/env';
import type { Appointment } from '@/domain/entities/appointment';
import { err } from '@/domain/result';
import type { PhoneE164 } from '@/domain/value-objects/phone';
import {
  SpokiActivityLog,
  SpokiService,
  buildTemplateSendPayload,
  contactFieldsFrom,
  oscuraNumeri,
  type SpokiServiceConfig,
  type SpokiTemplateKind,
} from '@/infrastructure/messaging/spoki';
import type { NotificationKind } from '@/domain/entities/notification';
import type { IsoDate, IsoDateTime } from '@/domain/value-objects/iso-date';
import {
  SPOKI_BUTTON_FIELD,
  SPOKI_BUTTON_PAYLOADS,
  type SpokiSendRequestDto,
} from '@/services/dto/spoki.dto';
import { providerError } from '@/services/interfaces/common';
import type { ISpokiService } from '@/services/interfaces/ISpokiService';
import { NoopLogger } from '@/services/mocks/ConsoleLogger';
import { SequentialIdGenerator } from '@/services/mocks/SequentialIdGenerator';
import { AUTOMAZIONI_PULSANTI, PULSANTE_IN_ATTESA, PULSANTI } from '../../scripts/spoki-spec.mjs';
import { buildTestEnv, makeAppointment, TEST_DATE, TestClock } from '../helpers/fixtures';

const NUMERO = '+393331234560' as PhoneE164;
const ALTRO = '+393339876540' as PhoneE164;

const NESSUNO: Readonly<Record<SpokiTemplateKind, null>> = {
  REMINDER_PREVIOUS_DAY: null,
  REMINDER_SAME_DAY: null,
  ARRIVAL_CONFIRMED: null,
  LATE_CONFIRMED: null,
  ABSENT_CONFIRMED: null,
  ARRIVAL_TOO_EARLY: null,
  CHECK_IN_STARTED: null,
  CHECK_IN_COMPLETED: null,
  CONFIRMATION: null,
  TURN_APPROACHING: null,
  CANCELLATION: null,
};

interface FetchCall {
  readonly url: string;
  readonly init: RequestInit;
}

function servizio(
  overrides: Partial<SpokiServiceConfig>,
  responder: (call: FetchCall) => Response = () => new Response('{}', { status: 200 }),
) {
  const calls: FetchCall[] = [];
  const ids = new SequentialIdGenerator('s');
  const activityLog = new SpokiActivityLog(ids, 50);
  const config: SpokiServiceConfig = {
    mode: 'live',
    safetyLock: false,
    apiKey: 'chiave-segreta',
    apiBaseUrl: 'https://api.spoki.example',
    urls: NESSUNO,
    secrets: NESSUNO,
    templates: NESSUNO,
    timeoutMs: 1000,
    allowedRecipients: [NUMERO],
    publicSends: false,
    ...overrides,
  };
  const service = new SpokiService(config, {
    clock: new TestClock(),
    ids,
    logger: new NoopLogger(),
    activityLog,
    fetchImpl: async (url, init) => {
      const call = { url, init };
      calls.push(call);
      return responder(call);
    },
  });
  return { service, calls, activityLog };
}

/** Corpo di `GET /api/1/contacts/?phone=` come lo restituisce Spoki. */
function corpoContatti(...contatti: { phone: string; campi: Record<string, string> }[]): string {
  return JSON.stringify({
    count: contatti.length,
    next: null,
    previous: null,
    results: contatti.map((c, i) => ({
      id: 1000 + i,
      phone: c.phone,
      contactfield_set: Object.entries(c.campi).map(([codice, valore], j) => ({
        id: 50 + j,
        field: 332000 + j,
        visual_code: `%%${codice}%%`,
        value: valore,
        value_datetime: null,
      })),
    })),
  });
}

describe('Adapter Spoki: lettura dei campi di un contatto', () => {
  it('in live legge con GET /api/1/contacts/?phone= e la chiave nell’intestazione, senza corpo', async () => {
    const { service, calls } = servizio(
      {},
      () =>
        new Response(
          corpoContatti({
            phone: NUMERO,
            campi: { ACC_PULSANTE: 'ARRIVATO', ACC_PROMEMORIA: 'INVIATO', NOME_CLIENTE: 'Mario' },
          }),
          { status: 200 },
        ),
    );
    const r = await service.readContactFields({
      to: NUMERO,
      codes: [SPOKI_BUTTON_FIELD],
      correlationId: 'c-1',
    });
    expect(r).toEqual({
      ok: true,
      value: { read: true, found: true, fields: { ACC_PULSANTE: 'ARRIVATO' } },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.spoki.example/api/1/contacts/?phone=%2B393331234560');
    expect(calls[0]?.init.method).toBe('GET');
    expect(calls[0]?.init.body).toBeUndefined();
    expect((calls[0]?.init.headers as Record<string, string>)['x-spoki-api-key']).toBe(
      'chiave-segreta',
    );
  });

  it('vale solo il contatto con lo stesso numero; nessun contatto = found false', () => {
    const corpo = corpoContatti(
      { phone: '393339876540', campi: { ACC_PULSANTE: 'ASSENTE' } },
      { phone: '393331234560', campi: { ACC_PULSANTE: 'RITARDO' } },
    );
    expect(contactFieldsFrom(corpo, NUMERO, ['ACC_PULSANTE'])).toEqual({
      found: true,
      fields: { ACC_PULSANTE: 'RITARDO' },
    });
    expect(contactFieldsFrom(corpoContatti(), NUMERO, ['ACC_PULSANTE'])).toEqual({
      found: false,
      fields: {},
    });
    expect(contactFieldsFrom('<html>', NUMERO, ['ACC_PULSANTE'])).toBeNull();
  });

  it('in simulazione, con il safety lock o per un numero fuori dalla demo non chiama la rete', async () => {
    for (const [overrides, numero] of [
      [{ mode: 'simulation' }, NUMERO],
      [{ safetyLock: true }, NUMERO],
      [{}, ALTRO],
    ] as const) {
      const { service, calls } = servizio(overrides);
      const r = await service.readContactFields({
        to: numero,
        codes: [SPOKI_BUTTON_FIELD],
        correlationId: 'c-2',
      });
      expect(r).toEqual({ ok: true, value: { read: false, found: false, fields: {} } });
      expect(calls).toHaveLength(0);
    }
  });

  it('errori: 429 ritentabile, 401 no, corpo illeggibile ritentabile, senza chiave nessuna chiamata', async () => {
    const leggi = async (s: ReturnType<typeof servizio>['service']) =>
      s.readContactFields({ to: NUMERO, codes: [SPOKI_BUTTON_FIELD], correlationId: 'c-3' });
    const troppe = await leggi(servizio({}, () => new Response('', { status: 429 })).service);
    expect(troppe.ok ? null : [troppe.error.code, troppe.error.retryable]).toEqual([
      'RATE_LIMIT',
      true,
    ]);
    const negato = await leggi(servizio({}, () => new Response('', { status: 401 })).service);
    expect(negato.ok ? null : [negato.error.code, negato.error.retryable]).toEqual(['AUTH', false]);
    const strano = await leggi(servizio({}, () => new Response('ok', { status: 200 })).service);
    expect(strano.ok ? null : [strano.error.code, strano.error.retryable]).toEqual([
      'PROVIDER_ERROR',
      true,
    ]);
    const senzaChiave = servizio({ apiKey: null });
    const r = await leggi(senzaChiave.service);
    expect(r.ok ? null : r.error.code).toBe('AUTH');
    expect(senzaChiave.calls).toHaveLength(0);
  });
});

describe('Adapter Spoki: il numero non finisce nei messaggi d’errore', () => {
  it('le cifre di un telefono (anche «%2B39…» di una query) vengono mascherate', () => {
    const testo = oscuraNumeri(
      'Failed to parse URL from api.spoki.com/api/1/contacts/?phone=%2B393331234560',
    );
    expect(testo).not.toContain('393331234560');
    expect(testo).toContain('4560');
  });
});

describe('Promemoria del mattino: arma le automazioni dei pulsanti', () => {
  const richiesta: SpokiSendRequestDto = {
    idempotencyKey: 'app-1:REMINDER_SAME_DAY:2026-09-10',
    to: NUMERO,
    templateKey: 'reminder_same_day',
    variables: {
      customerName: 'Mario Rossi',
      scheduledTime: '09:30',
      vehicleLabel: 'Fiat Panda',
      plate: 'AB123CD',
      scheduledDate: '10/09/2026',
      site: 'Via Napoli 364 B2/B3, Bari',
    },
    correlationId: 'c-4',
  };

  it('con la lettura accesa scrive ACC_PROMEMORIA = INVIATO e ACC_PULSANTE = ATTESA', () => {
    const p = buildTemplateSendPayload(richiesta, 'REMINDER_SAME_DAY', '508848', {
      replyPolling: true,
    });
    expect(p.custom_fields).toMatchObject({ ACC_PROMEMORIA: 'INVIATO', ACC_PULSANTE: 'ATTESA' });
  });

  it('con `replyPolling` nella configurazione del servizio, il payload registrato porta i campi', async () => {
    const { service, activityLog } = servizio({
      mode: 'simulation',
      templates: { ...NESSUNO, REMINDER_SAME_DAY: '508848' },
      replyPolling: true,
    });
    const r = await service.sendTemplateMessage({
      ...richiesta,
      templateKey: 'reminder_same_day_v1',
    });
    expect(r.ok).toBe(true);
    const voce = activityLog.list(5)[0];
    expect(voce?.payload['custom_fields']).toMatchObject({
      ACC_PROMEMORIA: 'INVIATO',
      ACC_PULSANTE: 'ATTESA',
    });
  });

  it('il giorno prima non tocca ACC_PULSANTE; con la lettura spenta nessun campo ACC_', () => {
    const d1 = buildTemplateSendPayload(richiesta, 'REMINDER_PREVIOUS_DAY', '454558', {
      replyPolling: true,
    });
    expect(Object.keys(d1.custom_fields).filter((k) => k.startsWith('ACC_'))).toEqual([]);
    const spenta = buildTemplateSendPayload(richiesta, 'REMINDER_SAME_DAY', '508848', {});
    expect(Object.keys(spenta.custom_fields).filter((k) => k.startsWith('ACC_'))).toEqual([]);
  });

  it('i valori delle automazioni in Spoki sono quelli che l’app legge', () => {
    expect(PULSANTE_IN_ATTESA).toBe('ATTESA');
    expect(
      Object.fromEntries(
        AUTOMAZIONI_PULSANTI.map((a) => [
          a.scrive.valore,
          PULSANTI.find((p) => p.chiave === a.chiave)?.payload,
        ]),
      ),
    ).toEqual(SPOKI_BUTTON_PAYLOADS);
    for (const a of AUTOMAZIONI_PULSANTI) {
      expect(a.scrive.campo).toBe(SPOKI_BUTTON_FIELD);
      expect(a.condizione).toEqual({ campo: 'ACC_PROMEMORIA', uguale: 'INVIATO' });
    }
  });
});

/** Orologio fermo il cui «oggi» si può spostare (per il cambio di giornata). */
class GiornoMobile extends TestClock {
  giorno: IsoDate = TEST_DATE;

  override today(): IsoDate {
    return this.giorno;
  }
}

/** Ambiente del servizio di lettura: mock Spoki, portale e coda veri. */
function setup(
  opzioni: {
    readonly enabled?: boolean;
    readonly maxCallsPerTick?: number;
    readonly intervalSeconds?: number;
    readonly spoki?: (base: ISpokiService) => ISpokiService;
    readonly repliesByAutomation?: boolean;
    readonly clock?: TestClock;
    /** Eseguito dentro l'applicazione del tocco (per simulare un secondo tocco nel frattempo). */
    readonly duranteHandle?: () => void;
  } = {},
) {
  const clock = opzioni.clock ?? new TestClock();
  const env = buildTestEnv(clock);
  const portal = new CustomerPortalService({
    appointments: env.appointments,
    referenceData: env.referenceData,
    operators: env.operators,
    eventBus: env.eventBus,
    clock,
    ids: env.ids,
    logger: env.logger,
    tokens: null,
    writesRequireToken: false,
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
    repliesByAutomation: opzioni.repliesByAutomation === true,
  });
  const chiamate: { readonly text: string; readonly code: string | null }[] = [];
  const conteggiato: Pick<WhatsAppInboundService, 'handle'> = {
    handle: async (m) => {
      chiamate.push({ text: m.text, code: m.code ?? null });
      opzioni.duranteHandle?.();
      return inbound.handle(m);
    },
  };
  const spoki = opzioni.spoki?.(env.spoki) ?? env.spoki;
  const poller = new SpokiReplyPoller({
    appointments: env.appointments,
    notifications: env.notifications,
    spoki,
    inbound: conteggiato,
    clock,
    ids: env.ids,
    logger: env.logger,
    enabled: opzioni.enabled ?? true,
    intervalSeconds: opzioni.intervalSeconds ?? 20,
    ...(opzioni.maxCallsPerTick === undefined ? {} : { maxCallsPerTick: opzioni.maxCallsPerTick }),
  });
  const testi = () => chiamate.map((c) => c.text);
  return { env, poller, chiamate, testi };
}

type Env = ReturnType<typeof setup>['env'];

/** Una pratica di oggi in coda con un promemoria già partito (di serie quello del mattino). */
async function conPromemoria(
  env: Env,
  phone: PhoneE164 = NUMERO,
  opzioni: { readonly kind?: NotificationKind; readonly orario?: string } = {},
): Promise<Appointment> {
  const base = makeAppointment();
  const r = await env.appointments.insert({
    ...base,
    ...(opzioni.orario === undefined
      ? {}
      : { scheduledAt: `2026-09-10T${opzioni.orario}:00.000Z` as IsoDateTime }),
    customer: { ...base.customer, phone },
  });
  if (!r.ok) {
    throw new Error(r.error.message);
  }
  const brand = (await env.referenceData.listBrands()).find((b) => b.id === r.value.brandId);
  if (brand === undefined) {
    throw new Error('marchio mancante nel seed');
  }
  await env.orchestrator.sendReminder({
    appointment: r.value,
    brand,
    kind: opzioni.kind ?? 'REMINDER_SAME_DAY',
    correlationId: 'c-promemoria',
  });
  return r.value;
}

const ultimoAggiornamento = (env: Env) => env.spoki.contactUpdates.at(-1)?.fields;

/** Spoki con la lettura o la scrittura sostituite; il resto resta quello del mock. */
function conSpoki(
  sostituti: Partial<Pick<ISpokiService, 'readContactFields' | 'updateContactFields'>>,
): (base: ISpokiService) => ISpokiService {
  return (base) => Object.assign(Object.create(base) as ISpokiService, sostituti);
}

describe('SpokiReplyPoller: dal campo ACC_PULSANTE alla pratica', () => {
  it('«Sono arrivato»: registra l’arrivo, risponde il cliente dall’app e rimette ATTESA', async () => {
    const { env, poller, testi } = setup({ repliesByAutomation: true });
    const a = await conPromemoria(env);
    env.spoki.simulateButtonTap(NUMERO, 'ARRIVATO');

    const giro = await poller.tick();
    expect(giro).toEqual({ watched: 1, read: 1, blocked: 0, applied: 1, failed: 0 });
    expect(testi()).toEqual(['ACTION_ARRIVED']);
    const corrente = await env.appointments.findById(a.id);
    expect(corrente?.customerArrivedAt).not.toBeNull();
    // Canale POLLING: risponde sempre l'app, anche con SPOKI_REPLIES_BY_AUTOMATION acceso.
    const jobs = await env.notifications.listByAppointment(a.id);
    expect(jobs.some((j) => j.kind === 'ARRIVAL_CONFIRMED')).toBe(true);
    expect(ultimoAggiornamento(env)).toEqual({ ACC_PULSANTE: 'ATTESA' });

    // Arrivato: non si guarda più.
    expect((await poller.tick()).watched).toBe(0);
    expect(poller.status()).toMatchObject({ enabled: true, appliedTotal: 1, lastError: null });
  });

  it('«Sono in ritardo» e «Non posso venire»: ritardo segnalato, pratica assente', async () => {
    const { env, poller } = setup();
    const inRitardo = await conPromemoria(env, NUMERO);
    const assente = await conPromemoria(env, ALTRO);
    env.spoki.simulateButtonTap(NUMERO, 'RITARDO');
    env.spoki.simulateButtonTap(ALTRO, 'ASSENTE');

    expect((await poller.tick()).applied).toBe(2);
    expect((await env.appointments.findById(inRitardo.id))?.customerLateNoticeAt).not.toBeNull();
    expect((await env.appointments.findById(assente.id))?.status).toBe('NO_SHOW');
  });

  it('due auto sullo stesso numero: ogni tocco va alla prima ancora da guardare, mai a una già arrivata', async () => {
    const { env, poller, chiamate } = setup();
    const prima = await conPromemoria(env, NUMERO, { orario: '07:00' });
    const seconda = await conPromemoria(env, NUMERO, { orario: '07:30' });

    env.spoki.simulateButtonTap(NUMERO, 'ARRIVATO');
    await poller.tick();
    expect((await env.appointments.findById(prima.id))?.customerArrivedAt).not.toBeNull();
    expect((await env.appointments.findById(seconda.id))?.customerArrivedAt).toBeNull();

    // Il secondo tocco è «Non posso venire»: assente la seconda, non chi è già in sala.
    env.spoki.simulateButtonTap(NUMERO, 'ASSENTE');
    await poller.tick();
    expect((await env.appointments.findById(prima.id))?.status).toBe('WAITING');
    expect((await env.appointments.findById(seconda.id))?.status).toBe('NO_SHOW');
    expect(chiamate.map((c) => c.code)).toEqual([prima.code, seconda.code]);
  });

  it('ATTESA o nessun campo: niente da applicare e niente da scrivere', async () => {
    const { env, poller, testi } = setup();
    await conPromemoria(env);
    const prima = env.spoki.contactUpdates.length;
    expect(await poller.tick()).toEqual({ watched: 1, read: 1, blocked: 0, applied: 0, failed: 0 });
    env.spoki.simulateButtonTap(NUMERO, 'ATTESA');
    expect((await poller.tick()).applied).toBe(0);
    expect(testi()).toEqual([]);
    expect(env.spoki.contactUpdates.length).toBe(prima);
  });

  it('si guardano solo le pratiche con il promemoria del mattino arrivato davvero su WhatsApp', async () => {
    const { env, poller } = setup();
    // Nessun promemoria.
    const senza = makeAppointment();
    expect((await env.appointments.insert(senza)).ok).toBe(true);
    // Solo il promemoria del giorno prima.
    await conPromemoria(env, ALTRO, { kind: 'REMINDER_PREVIOUS_DAY' });
    // Promemoria del mattino finito sull'SMS (il mock rifiuta WhatsApp per i numeri che finiscono con 9).
    const sms = '+393331234569' as PhoneE164;
    await conPromemoria(env, sms);
    // Promemoria del mattino fermato dal guardrail: a Spoki non è arrivato niente.
    const simulato = await conPromemoria(env, '+393335550001' as PhoneE164);
    for (const job of await env.notifications.listByAppointment(simulato.id)) {
      await env.notifications.updateJob({
        ...job,
        attempts: job.attempts.map((t) => ({ ...t, providerMessageId: `sim-${t.id}` })),
      });
    }
    for (const n of [NUMERO, ALTRO, sms, '+393335550001']) {
      env.spoki.simulateButtonTap(n, 'ASSENTE');
    }
    expect(await poller.tick()).toEqual({ watched: 0, read: 0, blocked: 0, applied: 0, failed: 0 });
  });

  it('spento non legge niente; una lettura bloccata dal guardrail non applica niente', async () => {
    const spento = setup({ enabled: false });
    await conPromemoria(spento.env);
    spento.env.spoki.simulateButtonTap(NUMERO, 'ARRIVATO');
    expect((await spento.poller.tick()).watched).toBe(0);
    expect(spento.chiamate).toEqual([]);
    expect(spento.poller.start()).toBeTypeOf('function');
    expect(spento.poller.status().running).toBe(false);

    const bloccato = setup({
      spoki: conSpoki({
        readContactFields: async () => ({
          ok: true as const,
          value: { read: false, found: false, fields: {} },
        }),
      }),
    });
    await conPromemoria(bloccato.env);
    expect(await bloccato.poller.tick()).toEqual({
      watched: 1,
      read: 0,
      blocked: 1,
      applied: 0,
      failed: 0,
    });
    expect(bloccato.chiamate).toEqual([]);
  });

  it('se ATTESA non si scrive, la passata dopo riprova ad azzerare senza riapplicare il tocco', async () => {
    let fallisci = true;
    const { env, poller, testi } = setup({
      spoki: (base) =>
        conSpoki({
          updateContactFields: async (...args) =>
            fallisci
              ? err(providerError('SPOKI', 'NETWORK', 'rete giù', true))
              : base.updateContactFields(...args),
        })(base),
    });
    await conPromemoria(env);
    env.spoki.simulateButtonTap(NUMERO, 'RITARDO');
    expect((await poller.tick()).applied).toBe(1);
    fallisci = false;
    expect((await poller.tick()).applied).toBe(0);
    expect(testi()).toEqual(['ACTION_LATE']);
    expect(ultimoAggiornamento(env)).toEqual({ ACC_PULSANTE: 'ATTESA' });
  });

  it('anche quando la pratica non è più da guardare (assente) l’azzeramento si riprova', async () => {
    let fallisci = true;
    const { env, poller, testi } = setup({
      spoki: (base) =>
        conSpoki({
          updateContactFields: async (...args) =>
            fallisci
              ? err(providerError('SPOKI', 'TIMEOUT', 'lento', true))
              : base.updateContactFields(...args),
        })(base),
    });
    const a = await conPromemoria(env);
    env.spoki.simulateButtonTap(NUMERO, 'ASSENTE');
    await poller.tick();
    expect((await env.appointments.findById(a.id))?.status).toBe('NO_SHOW');
    fallisci = false;
    // La pratica è uscita dall'elenco, ma il campo rimasto ASSENTE si rimette ad ATTESA.
    expect((await poller.tick()).watched).toBe(0);
    expect(ultimoAggiornamento(env)).toEqual({ ACC_PULSANTE: 'ATTESA' });
    expect(testi()).toEqual(['ACTION_ABSENT']);
  });

  it('al cambio di giornata gli azzeramenti in sospeso non si trascinano', async () => {
    const clock = new GiornoMobile();
    let scritture = 0;
    const { env, poller } = setup({
      clock,
      spoki: conSpoki({
        updateContactFields: async () => {
          scritture += 1;
          return err(providerError('SPOKI', 'NETWORK', 'rete giù', true));
        },
      }),
    });
    await conPromemoria(env);
    env.spoki.simulateButtonTap(NUMERO, 'ASSENTE');
    await poller.tick();
    const primaDelCambio = scritture;
    expect(primaDelCambio).toBeGreaterThan(0);
    clock.giorno = '2026-09-11' as IsoDate;
    await poller.tick();
    expect(scritture).toBe(primaDelCambio);
  });

  it('un secondo tocco arrivato mentre si applicava il primo non viene cancellato', async () => {
    const holder: { env?: Env; fatto: boolean } = { fatto: false };
    const { env, poller, testi } = setup({
      duranteHandle: () => {
        if (!holder.fatto) {
          holder.fatto = true;
          holder.env?.spoki.simulateButtonTap(NUMERO, 'ARRIVATO');
        }
      },
    });
    holder.env = env;
    const a = await conPromemoria(env);
    env.spoki.simulateButtonTap(NUMERO, 'RITARDO');
    await poller.tick();
    // Il campo è cambiato durante l'applicazione di RITARDO: non si rimette ad ATTESA.
    expect(env.spoki.contactUpdates.some((u) => u.fields[SPOKI_BUTTON_FIELD] === 'ATTESA')).toBe(
      false,
    );
    await poller.tick();
    expect(testi()).toEqual(['ACTION_LATE', 'ACTION_ARRIVED']);
    expect((await env.appointments.findById(a.id))?.customerArrivedAt).not.toBeNull();
    expect(ultimoAggiornamento(env)).toEqual({ ACC_PULSANTE: 'ATTESA' });
  });

  it('«troppe richieste» ferma la passata; un altro errore no. L’errore resta con la sua ora', async () => {
    const letti: string[] = [];
    const troppe = setup({
      spoki: conSpoki({
        readContactFields: async (req) => {
          letti.push(req.to);
          return err(providerError('SPOKI', 'RATE_LIMIT', 'troppe', true));
        },
      }),
    });
    await conPromemoria(troppe.env, NUMERO);
    await conPromemoria(troppe.env, ALTRO);
    expect((await troppe.poller.tick()).failed).toBe(1);
    expect(letti).toHaveLength(1);
    expect(troppe.poller.status()).toMatchObject({
      lastError: 'RATE_LIMIT: troppe',
      lastErrorAt: '2026-09-10T08:00:00.000Z',
    });

    const rete = setup({
      spoki: conSpoki({
        readContactFields: async () => err(providerError('SPOKI', 'NETWORK', 'giù', true)),
      }),
    });
    await conPromemoria(rete.env, NUMERO);
    await conPromemoria(rete.env, ALTRO);
    expect((await rete.poller.tick()).failed).toBe(2);
  });

  it('con più contatti del budget per passata si prosegue a rotazione', async () => {
    const letti: string[] = [];
    const { env, poller } = setup({
      maxCallsPerTick: 1,
      spoki: (base) =>
        conSpoki({
          readContactFields: async (...args) => {
            letti.push(args[0].to);
            return base.readContactFields(...args);
          },
        })(base),
    });
    await conPromemoria(env, NUMERO);
    await conPromemoria(env, ALTRO);
    await poller.tick();
    await poller.tick();
    await poller.tick();
    expect(letti).toHaveLength(3);
    expect(new Set(letti.slice(0, 2)).size).toBe(2);
    expect(letti[2]).toBe(letti[0]);
  });

  it('il budget segue l’intervallo: metà del tetto di Spoki al minuto, mai più di 20 a passata', () => {
    expect(setup({ intervalSeconds: 10 }).poller.status().callsPerTick).toBe(10);
    expect(setup({ intervalSeconds: 20 }).poller.status().callsPerTick).toBe(20);
    expect(setup({ intervalSeconds: 300 }).poller.status().callsPerTick).toBe(20);
  });
});

describe('Configurazione della lettura dei pulsanti', () => {
  const avvisi: string[] = [];
  const leggi = (valori: Record<string, string>) => parseEnv(valori, (m) => avvisi.push(m));

  it('spenta di serie, ogni 20 secondi; fuori dai limiti torna nei limiti con un avviso', () => {
    expect(leggi({})).toMatchObject({ spokiReplyPolling: false, spokiReplyPollSeconds: 20 });
    expect(leggi({ SPOKI_REPLY_POLLING: 'true', SPOKI_REPLY_POLL_SECONDS: '45' })).toMatchObject({
      spokiReplyPolling: true,
      spokiReplyPollSeconds: 45,
    });
    avvisi.length = 0;
    expect(leggi({ SPOKI_REPLY_POLL_SECONDS: '3' }).spokiReplyPollSeconds).toBe(20);
    expect(leggi({ SPOKI_REPLY_POLL_SECONDS: '900' }).spokiReplyPollSeconds).toBe(300);
    expect(avvisi).toHaveLength(2);
  });
});
