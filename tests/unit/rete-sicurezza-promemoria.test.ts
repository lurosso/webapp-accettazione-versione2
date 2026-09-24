// Rete di sicurezza del promemoria del mattino (M8-T51-S08): se all'ora del promemoria il server è
// giù, lo manda un'automazione Spoki a chi ha ancora ACC_PROMEMORIA = DA_INVIARE. L'app, quando c'è,
// la disarma per chi non deve riceverlo e dall'ora della rete in poi non manda più il promemoria.
// In fondo, l'aggiornamento del contatto nell'adapter Spoki con i suoi blocchi.
import { describe, expect, it } from 'vitest';
import { AppointmentReminderService } from '@/application/notifications/AppointmentReminderService';
import { ReminderSafetyNet } from '@/application/notifications/ReminderSafetyNet';
import { SyncService } from '@/application/sync/SyncService';
import { CodeGenerator } from '@/application/queue/CodeGenerator';
import { parseEnv } from '@/config/env';
import type { Appointment, AppointmentStatus } from '@/domain/entities/appointment';
import type { NotificationKind } from '@/domain/entities/notification';
import type { IsoDate, IsoDateTime } from '@/domain/value-objects/iso-date';
import { isoDateTime } from '@/domain/value-objects/iso-date';
import type { PhoneE164 } from '@/domain/value-objects/phone';
import { SpokiActivityLog, SpokiService } from '@/infrastructure/messaging/spoki';
import type { SpokiServiceConfig, SpokiTemplateKind } from '@/infrastructure/messaging/spoki';
import { toBusinessDate } from '@/lib/dates';
import type { IClock } from '@/services/interfaces/IClock';
import { InfinityServiceMock } from '@/services/mocks/InfinityServiceMock';
import { NoopLogger } from '@/services/mocks/ConsoleLogger';
import { SequentialIdGenerator } from '@/services/mocks/SequentialIdGenerator';
import { buildTestEnv, makeAppointment, TEST_DATE, TestClock } from '../helpers/fixtures';

/** Orologio spostabile la cui giornata segue l'istante. */
class MovingClock implements IClock {
  private current: Date;

  constructor(iso: string) {
    this.current = new Date(iso);
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  nowIso(): IsoDateTime {
    return isoDateTime(this.current);
  }

  today(): IsoDate {
    return toBusinessDate(this.current, 'Europe/Rome');
  }

  set(iso: string): void {
    this.current = new Date(iso);
  }
}

const muto = () => undefined;

function setup(oraRete: string | null, adesso: string) {
  const clock = new MovingClock(adesso);
  const env = buildTestEnv(clock);
  const rete = new ReminderSafetyNet({
    appointments: env.appointments,
    notifications: env.notifications,
    spoki: env.spoki,
    clock,
    logger: env.logger,
    time: oraRete,
    timeZone: 'Europe/Rome',
  });
  const syncService = new SyncService({
    infinity: new InfinityServiceMock(
      {
        seed: 'rete',
        mode: 'ok',
        latencyMs: 0,
        flakyFailures: 0,
        cancelOnSecondCall: false,
        brands: env.seed.brands,
        desks: env.seed.desks,
      },
      { clock: env.clock, logger: env.logger },
    ),
    appointments: env.appointments,
    syncRuns: env.syncRuns,
    referenceData: env.referenceData,
    codeGenerator: new CodeGenerator(env.appointments, { sitePrefix: 'F', scope: 'SITE' }),
    eventBus: env.eventBus,
    clock: env.clock,
    ids: env.ids,
    logger: env.logger,
    timeZone: 'Europe/Rome',
  });
  const reminders = new AppointmentReminderService({
    appointments: env.appointments,
    referenceData: env.referenceData,
    orchestrator: env.orchestrator,
    syncService,
    clock,
    ids: env.ids,
    logger: env.logger,
    enabled: true,
    liveDeliveryAllowed: false,
    safetyNet: rete,
  });
  return { env, clock, rete, reminders };
}

type Env = ReturnType<typeof setup>['env'];

async function pratica(env: Env, status: AppointmentStatus, phone: string): Promise<Appointment> {
  const r = await env.appointments.insert(
    makeAppointment({
      status,
      businessDate: TEST_DATE,
      customer: { ...makeAppointment().customer, phone: phone as PhoneE164 },
    }),
  );
  if (!r.ok) {
    throw new Error(r.error.message);
  }
  return r.value;
}

/** Il promemoria del giorno prima parte con la pratica in attesa; poi la pratica cambia stato. */
async function cambia(env: Env, a: Appointment, status: AppointmentStatus): Promise<Appointment> {
  const corrente = await env.appointments.findById(a.id);
  if (corrente === null) {
    throw new Error('pratica');
  }
  const r = await env.appointments.update({ ...corrente, status }, corrente.version);
  if (!r.ok) {
    throw new Error(r.error.message);
  }
  return r.value;
}

/** Manda un messaggio vero dall'orchestratore (mock Spoki: i numeri che finiscono per 0–6 arrivano). */
async function manda(env: Env, a: Appointment, kind: NotificationKind): Promise<void> {
  const brand = (await env.referenceData.listBrands()).find((b) => b.id === a.brandId);
  if (brand === undefined) {
    throw new Error('marchio');
  }
  await env.orchestrator.sendReminder({ appointment: a, brand, kind, correlationId: 'c' });
}

describe('Ambiente: SPOKI_SAFETY_NET_TIME', () => {
  it('spenta di default; un orario valido dopo il promemoria del giorno la accende', () => {
    expect(parseEnv({}, muto).spokiSafetyNetTime).toBeNull();
    expect(parseEnv({ SPOKI_SAFETY_NET_TIME: '08:30' }, muto).spokiSafetyNetTime).toBe('08:30');
  });

  it('un orario non valido o non dopo il promemoria del giorno la spegne con un avviso', () => {
    const avvisi: string[] = [];
    const prima = parseEnv(
      { SPOKI_SAFETY_NET_TIME: '07:00', REMINDER_SAME_DAY_HOUR_LOCAL: '07:30' },
      (m) => avvisi.push(m),
    );
    expect(prima.spokiSafetyNetTime).toBeNull();
    expect(avvisi.some((m) => m.includes('SPOKI_SAFETY_NET_TIME=07:00'))).toBe(true);
    expect(
      parseEnv({ SPOKI_SAFETY_NET_TIME: '8.30' }, (m) => avvisi.push(m)).spokiSafetyNetTime,
    ).toBeNull();
    expect(avvisi.some((m) => m.includes('non è un orario'))).toBe(true);
  });
});

describe('ReminderSafetyNet', () => {
  it('handedOver: solo oggi e dall’ora della rete in poi; spenta non passa mai la mano', () => {
    // 06:20 UTC = 08:20 a Roma.
    const { clock, rete } = setup('08:30', '2026-09-10T06:20:00.000Z');
    expect(rete.handedOver(TEST_DATE)).toBe(false);
    clock.set('2026-09-10T06:30:00.000Z');
    expect(rete.handedOver(TEST_DATE)).toBe(true);
    expect(rete.handedOver('2026-09-11' as IsoDate)).toBe(false);
    const spenta = setup(null, '2026-09-10T10:00:00.000Z');
    expect(spenta.rete.handedOver(TEST_DATE)).toBe(false);
  });

  it('disarma solo chi ha avuto il promemoria del giorno prima su WhatsApp e non quello di oggi', async () => {
    const { env, rete } = setup('08:30', '2026-09-10T05:40:00.000Z');
    const promemoriaFatto = await pratica(env, 'WAITING', '+393331250001');
    const annullata = await pratica(env, 'WAITING', '+393331250002');
    const inCarico = await pratica(env, 'WAITING', '+393331250003');
    const soloSms = await pratica(env, 'WAITING', '+393331250009');
    for (const a of [promemoriaFatto, annullata, inCarico, soloSms]) {
      await manda(env, a, 'REMINDER_PREVIOUS_DAY');
    }
    await manda(env, promemoriaFatto, 'REMINDER_SAME_DAY');
    await cambia(env, annullata, 'CANCELLED');
    await cambia(env, inCarico, 'IN_PROGRESS');
    await cambia(env, soloSms, 'CANCELLED');
    // Annullata senza promemoria del giorno prima: la rete non l'ha mai armata.
    await pratica(env, 'CANCELLED', '+393331250004');

    const esito = await rete.disarm(TEST_DATE, 'corr-rete');
    expect(esito).toEqual({ candidates: 2, disarmed: 2, failed: 0 });
    expect(env.spoki.contactUpdates.map((u) => u.to).sort()).toEqual(
      [annullata.customer.phone, inCarico.customer.phone].sort(),
    );
    expect(env.spoki.contactUpdates[0]?.fields).toEqual({ ACC_PROMEMORIA: 'NON_SERVE' });
  });

  it('con la rete spenta non tocca nessun contatto', async () => {
    const { env, rete } = setup(null, '2026-09-10T05:40:00.000Z');
    const annullata = await pratica(env, 'WAITING', '+393331250005');
    await manda(env, annullata, 'REMINDER_PREVIOUS_DAY');
    await cambia(env, annullata, 'CANCELLED');
    expect(await rete.disarm(TEST_DATE, 'c')).toEqual({ candidates: 0, disarmed: 0, failed: 0 });
    expect(env.spoki.contactUpdates).toEqual([]);
  });
});

describe('Promemoria del giorno con la rete di sicurezza', () => {
  it('prima dell’ora della rete: il promemoria parte e poi la rete si disarma per gli annullati', async () => {
    const { env, reminders } = setup('08:30', '2026-09-10T05:40:00.000Z');
    const attesa = await pratica(env, 'WAITING', '+393331250011');
    const annullata = await pratica(env, 'WAITING', '+393331250012');
    await manda(env, attesa, 'REMINDER_PREVIOUS_DAY');
    await manda(env, annullata, 'REMINDER_PREVIOUS_DAY');
    await cambia(env, annullata, 'CANCELLED');

    const esito = await reminders.sendSameDayReminders(TEST_DATE);
    expect(esito.skippedReason).toBeNull();
    expect(esito.candidates).toBe(1);
    expect(env.spoki.contactUpdates.map((u) => u.to)).toEqual([annullata.customer.phone]);
  });

  it('dall’ora della rete in poi l’app non manda il promemoria del giorno: lo ha già mandato Spoki', async () => {
    // 06:45 UTC = 08:45 a Roma, dopo le 08:30 della rete (il server si è rimesso in pari tardi).
    const { env, reminders } = setup('08:30', '2026-09-10T06:45:00.000Z');
    await pratica(env, 'WAITING', '+393331250021');
    const esito = await reminders.sendSameDayReminders(TEST_DATE);
    expect(esito.skippedReason).toContain('rete di sicurezza Spoki');
    expect(esito.candidates).toBe(0);
    expect(await env.notifications.listByDate(TEST_DATE)).toEqual([]);
  });
});

// --- Adapter: aggiornamento del contatto -------------------------------------------------------------

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

function servizio(overrides: Partial<SpokiServiceConfig>, risposta?: () => Response) {
  const chiamate: { url: string; init: RequestInit }[] = [];
  const ids = new SequentialIdGenerator('k');
  const activityLog = new SpokiActivityLog(ids, 20);
  const service = new SpokiService(
    {
      mode: 'simulation',
      safetyLock: true,
      apiKey: null,
      apiBaseUrl: 'https://api.spoki.example',
      urls: NESSUNO,
      secrets: NESSUNO,
      templates: NESSUNO,
      timeoutMs: 1000,
      ...overrides,
    },
    {
      clock: new TestClock(),
      ids,
      logger: new NoopLogger(),
      activityLog,
      fetchImpl: async (url, init) => {
        chiamate.push({ url, init });
        return risposta === undefined ? new Response('{}', { status: 200 }) : risposta();
      },
    },
  );
  return { service, activityLog, chiamate };
}

const AGGIORNAMENTO = {
  to: '+393331234567' as PhoneE164,
  fields: { ACC_PROMEMORIA: 'NON_SERVE' },
  correlationId: 'corr-contatto',
};

describe('SpokiService.updateContactFields', () => {
  it('in simulazione non chiama la rete: registro «CONTACT» e updated false', async () => {
    const { service, activityLog, chiamate } = servizio({});
    const r = await service.updateContactFields(AGGIORNAMENTO);
    expect(r.ok && r.value.updated).toBe(false);
    expect(chiamate).toHaveLength(0);
    const voce = activityLog.list()[0];
    expect(voce?.templateKind).toBe('CONTACT');
    expect(voce?.blockedBy).toBe('SIMULATION');
    expect(voce?.url).toBe('https://api.spoki.example/api/1/contacts/sync/');
    expect(voce?.payload).toEqual({
      phone: '+393331234567',
      custom_fields: { ACC_PROMEMORIA: 'NON_SERVE' },
    });
  });

  it('demo interna: in live con il blocco tolto un numero fuori lista non viene toccato', async () => {
    const { service, activityLog, chiamate } = servizio({
      mode: 'live',
      safetyLock: false,
      apiKey: 'chiave-di-prova',
      allowedRecipients: ['+393470000000'],
    });
    const r = await service.updateContactFields(AGGIORNAMENTO);
    expect(r.ok && r.value.updated).toBe(false);
    expect(chiamate).toHaveLength(0);
    expect(activityLog.list()[0]?.blockedBy).toBe('DEMO_ALLOWLIST');
  });

  it('in live e ammesso: POST /api/1/contacts/sync/ con la chiave e i soli campi', async () => {
    const { service, chiamate } = servizio({
      mode: 'live',
      safetyLock: false,
      apiKey: 'chiave-di-prova',
      publicSends: true,
    });
    const r = await service.updateContactFields(AGGIORNAMENTO);
    expect(r.ok && r.value.updated).toBe(true);
    expect(chiamate).toHaveLength(1);
    expect(chiamate[0]?.url).toBe('https://api.spoki.example/api/1/contacts/sync/');
    const headers = chiamate[0]?.init.headers as Record<string, string>;
    expect(headers['x-spoki-api-key']).toBe('chiave-di-prova');
    expect(JSON.parse(String(chiamate[0]?.init.body))).toEqual({
      phone: '+393331234567',
      custom_fields: { ACC_PROMEMORIA: 'NON_SERVE' },
    });
  });

  it('errore di Spoki ritentabile, e senza chiave API nessuna chiamata', async () => {
    const giu = servizio(
      { mode: 'live', safetyLock: false, apiKey: 'chiave-di-prova', publicSends: true },
      () => new Response('guasto', { status: 503 }),
    );
    const r = await giu.service.updateContactFields(AGGIORNAMENTO);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.retryable).toBe(true);
    const senzaChiave = servizio({ mode: 'live', safetyLock: false, publicSends: true });
    const r2 = await senzaChiave.service.updateContactFields(AGGIORNAMENTO);
    expect(!r2.ok && r2.error.code).toBe('AUTH');
    expect(senzaChiave.chiamate).toHaveLength(0);
  });
});
