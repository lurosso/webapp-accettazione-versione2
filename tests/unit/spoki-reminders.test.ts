// I due promemoria Spoki (giorno prima, giorno stesso): variabili, testi, payload e guardrail
// visti dal lato applicativo (template, orchestratore, pannello di diagnostica).
import { describe, expect, it } from 'vitest';
import {
  SPOKI_TEST_KINDS,
  SpokiDiagnosticsService,
  spokiBlockReason,
  type SpokiDiagnosticsConfig,
} from '@/application/messaging/SpokiDiagnosticsService';
import { buildTemplateVars, NOTIFICATION_TEMPLATES } from '@/application/notifications/templates';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import type { PhoneE164 } from '@/domain/value-objects/phone';
import { SpokiActivityLog, SpokiService } from '@/infrastructure/messaging/spoki';
import { NoopLogger } from '@/services/mocks/ConsoleLogger';
import { SequentialIdGenerator } from '@/services/mocks/SequentialIdGenerator';
import { buildTestEnv, makeAppointment, TestClock } from '../helpers/fixtures';

/** Appuntamento di domani (11/09/2026) alle 09:30 di Roma (07:30 UTC in ora legale). */
function appuntamentoDomani() {
  return makeAppointment({
    businessDate: '2026-09-11' as never,
    scheduledAt: '2026-09-11T07:30:00.000Z' as IsoDateTime,
    customer: {
      ...makeAppointment().customer,
      firstName: 'Anna',
      lastName: 'Bianchi',
      phone: '+393339876543' as PhoneE164,
      email: 'anna@esempio.it',
    },
  });
}

describe('Promemoria: variabili e testi', () => {
  it('le variabili portano orario locale, data italiana, cognome, e-mail e link al portale', () => {
    const env = buildTestEnv();
    const brand = env.seed.brands[0]!;
    const vars = buildTemplateVars(
      appuntamentoDomani(),
      brand,
      'Europe/Rome',
      'https://officina.example',
    );
    expect(vars.scheduledTime).toBe('09:30');
    expect(vars.scheduledDate).toBe('11/09/2026');
    expect(vars.firstName).toBe('Anna');
    expect(vars.lastName).toBe('Bianchi');
    expect(vars.email).toBe('anna@esempio.it');
    expect(vars.portalUrl).toBe(`https://officina.example/portal?targa=${vars.plate}`);
  });

  it('il giorno prima cita data, ora e targa; il giorno stesso ora, targa e le tre opzioni', () => {
    const env = buildTestEnv();
    const a = appuntamentoDomani();
    const vars = buildTemplateVars(
      a,
      env.seed.brands[0]!,
      'Europe/Rome',
      'https://officina.example',
    );
    const prima = NOTIFICATION_TEMPLATES.REMINDER_PREVIOUS_DAY.render(vars);
    expect(prima).toContain('Gentile cliente');
    expect(prima).toContain('domani 11/09/2026 alle ore 09:30');
    expect(prima).toContain(`targa ${a.vehicle.plate}`);
    expect(prima).toContain('A domani!');
    const stesso = NOTIFICATION_TEMPLATES.REMINDER_SAME_DAY.render(vars);
    expect(stesso).toContain('Buongiorno!');
    expect(stesso).toContain('oggi alle ore 09:30');
    expect(stesso).toContain(a.vehicle.plate);
    expect(stesso).toContain("selezioni un'opzione");
    expect(stesso).toContain('1) Sono arrivato');
    expect(stesso).not.toContain('http');
    expect(NOTIFICATION_TEMPLATES.REMINDER_PREVIOUS_DAY.spokiTemplateKey).toBe(
      'reminder_previous_day_v1',
    );
    expect(NOTIFICATION_TEMPLATES.REMINDER_SAME_DAY.spokiTemplateKey).toBe('reminder_same_day_v1');
  });
});

describe('Promemoria: dal record della pratica al payload Spoki, passando dal servizio reale bloccato', () => {
  it('il payload ha phone E.164, first_name e custom_fields code/plate/time/date/portal_url', async () => {
    const env = buildTestEnv();
    const clock = new TestClock();
    const ids = new SequentialIdGenerator('p');
    const activityLog = new SpokiActivityLog(ids);
    const spoki = new SpokiService(
      {
        mode: 'live',
        safetyLock: true, // blocco attivo: la chiamata non deve partire
        apiKey: null,
        apiBaseUrl: 'https://api.spoki.example',
        urls: {
          REMINDER_PREVIOUS_DAY: 'https://api.spoki.example/wh/ap/prev/',
          REMINDER_SAME_DAY: 'https://api.spoki.example/wh/ap/same/',
          ARRIVAL_CONFIRMED: null,
          LATE_CONFIRMED: null,
          ABSENT_CONFIRMED: null,
          CHECK_IN_STARTED: null,
          CHECK_IN_COMPLETED: null,
          CONFIRMATION: null,
          TURN_APPROACHING: null,
          CANCELLATION: null,
        },
        secrets: {
          REMINDER_PREVIOUS_DAY: 'segreto-prev-0123456789abcdef',
          REMINDER_SAME_DAY: 'segreto-same-0123456789abcdef',
          ARRIVAL_CONFIRMED: null,
          LATE_CONFIRMED: null,
          ABSENT_CONFIRMED: null,
          CHECK_IN_STARTED: null,
          CHECK_IN_COMPLETED: null,
          CONFIRMATION: null,
          TURN_APPROACHING: null,
          CANCELLATION: null,
        },
        templates: {
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
        },
        timeoutMs: 1000,
      },
      {
        clock,
        ids,
        logger: new NoopLogger(),
        activityLog,
        fetchImpl: async () => {
          throw new Error('la rete non deve essere toccata');
        },
      },
    );
    const a = appuntamentoDomani();
    const vars = buildTemplateVars(
      a,
      env.seed.brands[0]!,
      'Europe/Rome',
      'https://officina.example',
    );
    const r = await spoki.sendTemplateMessage({
      idempotencyKey: `${a.id}:REMINDER_PREVIOUS_DAY:2026-09-11:WA:1`,
      to: a.customer.phone!,
      templateKey: 'reminder_previous_day_v1',
      variables: { ...vars, text: NOTIFICATION_TEMPLATES.REMINDER_PREVIOUS_DAY.render(vars) },
      correlationId: 'c-1',
    });
    expect(r.ok).toBe(true);
    const voce = activityLog.list()[0];
    expect(voce?.blockedBy).toBe('SAFETY_LOCK');
    expect(voce?.payload).toMatchObject({
      phone: '+393339876543',
      first_name: 'Anna',
      last_name: 'Bianchi',
      email: 'anna@esempio.it',
      custom_fields: {
        code: a.code,
        plate: a.vehicle.plate,
        time: '09:30',
        date: '11/09/2026',
        portal_url: `https://officina.example/portal?targa=${a.vehicle.plate}`,
      },
    });
  });
});

describe('Pannello di diagnostica: guardrail del test manuale', () => {
  function setup(overrides: Partial<SpokiDiagnosticsConfig> = {}) {
    const env = buildTestEnv();
    const ids = new SequentialIdGenerator('d');
    const config: SpokiDiagnosticsConfig = {
      provider: 'real',
      mode: 'simulation',
      safetyLock: true,
      apiKey: null,
      reminders: {
        previousDay: { url: 'https://api.spoki.example/wh/ap/prev/', secret: 'segreto-prev' },
        sameDay: { url: null, secret: null },
      },
      publicBaseUrl: 'https://officina.example',
      reminderPreviousDayHourLocal: '18:00',
      reminderSameDayHourLocal: '07:30',
      remindersEnabled: true,
      ...overrides,
    };
    // Il finto WhatsApp del test env fa da porta; il registro resta vuoto ma il guardrail si prova lo stesso.
    const service = new SpokiDiagnosticsService({
      spoki: env.spoki,
      activityLog: new SpokiActivityLog(ids),
      appointments: env.appointments,
      config,
      ids,
      clock: env.clock,
      logger: env.logger,
    });
    return { env, service };
  }

  it('la panoramica espone blocco, motivo e stato di URL e segreti dei due promemoria', () => {
    const { service } = setup();
    const o = service.overview();
    expect(o.safetyLock).toBe(true);
    expect(o.liveDeliveryAllowed).toBe(false);
    expect(o.blockReason).toBe('SIMULATION');
    expect(o.templates.map((t) => t.kind)).toEqual([...SPOKI_TEST_KINDS]);
    expect(o.templates[0]).toMatchObject({
      urlEnvKey: 'SPOKI_URL_REMINDER_PREVIOUS_DAY',
      secretEnvKey: 'SPOKI_SECRET_REMINDER_PREVIOUS_DAY',
      urlConfigured: true,
      secretConfigured: true,
    });
    // Senza URL né id il promemoria del giorno stesso è un template via API da configurare: il
    // pannello indica la stessa variabile del servizio (`resolveTransportKind`).
    expect(o.templates[1]).toMatchObject({
      transport: 'TEMPLATE',
      templateEnvKey: 'SPOKI_TEMPLATE_SAME_DAY_ID',
      templateConfigured: false,
    });
    expect(spokiBlockReason('mock', 'live', false)).toBe('MOCK_PROVIDER');
    expect(spokiBlockReason('real', 'live', true)).toBe('SAFETY_LOCK');
    expect(spokiBlockReason('real', 'live', false)).toBeNull();
  });

  it('rifiuta il numero di un cliente in agenda: la prova va a un telefono digitato a mano', async () => {
    const { env, service } = setup();
    const reale = makeAppointment({
      customer: { ...makeAppointment().customer, phone: '+393330000001' as PhoneE164 },
    });
    await env.appointments.insert(reale);

    const rifiutato = await service.sendTest(
      { phone: '+39 333 0000001', kind: 'REMINDER_SAME_DAY' },
      { operatorId: 'op-admin' },
    );
    expect(rifiutato.ok).toBe(false);
    if (!rifiutato.ok) {
      expect(rifiutato.error.code).toBe('VALIDATION');
      expect(rifiutato.error.message).toContain('cliente presente in agenda');
    }

    const interno = await service.sendTest(
      { phone: '+39 333 7654320', kind: 'REMINDER_PREVIOUS_DAY', firstName: 'Luca' },
      { operatorId: 'op-admin' },
    );
    expect(interno.ok).toBe(true);
    if (interno.ok) {
      expect(interno.value.dryRun).toBe(true);
      expect(interno.value.blockReason).toBe('SIMULATION');
      expect(interno.value.templateKey).toBe('reminder_previous_day_v1');
      // Il giorno prima nella prova parla di domani rispetto all'orologio del test (10/09 → 11/09).
      expect(interno.value.renderedText).toContain('domani 11/09/2026');
      expect(interno.value.renderedText).toContain('targa AB123CD');
    }
  });
});
