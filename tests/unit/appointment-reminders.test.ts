// I due promemoria programmati: giorno prima (con sync anticipata di domani) e giorno stesso,
// dal servizio e dallo scheduler. Nessun WhatsApp reale: il test env usa i mock e il servizio
// dichiara `dryRun`.
import { describe, expect, it } from 'vitest';
import { InspectionArchiveService } from '@/application/media/InspectionArchiveService';
import { AppointmentReminderService } from '@/application/notifications/AppointmentReminderService';
import { CodeGenerator } from '@/application/queue/CodeGenerator';
import { QueueService } from '@/application/queue/QueueService';
import { SyncScheduler } from '@/application/sync/SyncScheduler';
import { SyncService } from '@/application/sync/SyncService';
import type { IsoDate, IsoDateTime } from '@/domain/value-objects/iso-date';
import { isoDateTime } from '@/domain/value-objects/iso-date';
import { toBusinessDate } from '@/lib/dates';
import type { IClock } from '@/services/interfaces/IClock';
import type { InfinityMockMode } from '@/services/interfaces/mock-config';
import { InfinityServiceMock } from '@/services/mocks/InfinityServiceMock';
import { buildTestEnv, TEST_DATE } from '../helpers/fixtures';

const DOMANI = '2026-09-11' as IsoDate;

/** Orologio spostabile la cui giornata operativa segue l'istante (a differenza di TestClock). */
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

function setup(options: { mode?: InfinityMockMode; enabled?: boolean; clock?: MovingClock } = {}) {
  const clock = options.clock ?? new MovingClock('2026-09-10T08:00:00.000Z');
  const env = buildTestEnv(clock);
  const infinity = new InfinityServiceMock(
    {
      seed: 'promemoria',
      mode: options.mode ?? 'ok',
      latencyMs: 0,
      flakyFailures: 0,
      cancelOnSecondCall: false,
      brands: env.seed.brands,
      desks: env.seed.desks,
    },
    { clock: env.clock, logger: env.logger },
  );
  const syncService = new SyncService({
    infinity,
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
    clock: env.clock,
    ids: env.ids,
    logger: env.logger,
    enabled: options.enabled ?? true,
    liveDeliveryAllowed: false,
  });
  return { env, clock, syncService, reminders };
}

describe('AppointmentReminderService: promemoria del giorno stesso', () => {
  it('scrive a chi è in attesa oggi, non a chi è già in carico, e la seconda volta non ripete', async () => {
    const { env, syncService, reminders } = setup();
    await syncService.runDailySync(TEST_DATE, 'SCHEDULED');
    const inCoda = await env.appointments.listByDate(TEST_DATE, { statuses: ['WAITING'] });
    expect(inCoda.length).toBeGreaterThan(5);
    const presa = inCoda[0]!;
    await env.appointments.update({ ...presa, status: 'IN_PROGRESS' }, presa.version);

    const esito = await reminders.sendSameDayReminders(TEST_DATE);
    expect(esito.kind).toBe('REMINDER_SAME_DAY');
    expect(esito.businessDate).toBe(TEST_DATE);
    expect(esito.dryRun).toBe(true);
    expect(esito.candidates).toBe(inCoda.length - 1);
    expect(esito.whatsapp + esito.sms + esito.manual + esito.retryable + esito.noRecipient).toBe(
      esito.candidates,
    );
    expect(esito.skippedReason).toBeNull();

    const jobs = await env.notifications.listByDate(TEST_DATE);
    expect(jobs.every((j) => j.kind === 'REMINDER_SAME_DAY')).toBe(true);
    expect(jobs.some((j) => j.appointmentId === presa.id)).toBe(false);
    const primo = jobs[0]!;
    expect(primo.templateVariables['scheduledDate']).toBe('10/09/2026');
    expect(primo.renderedText).toContain('oggi alle ore');
    // Il codice non è nel testo (lo dice la risposta a «Sono arrivato»), ma resta sul job e nelle variabili.
    expect(primo.templateVariables['code']).toBe(primo.code);
    expect(primo.renderedText).toContain(primo.templateVariables['plate'] ?? '');

    const secondo = await reminders.sendSameDayReminders(TEST_DATE);
    // I job FAILED (entrambi i canali in errore temporaneo) si ritentano: gli altri sono già fatti.
    expect(secondo.alreadyProcessed).toBe(esito.candidates - esito.retryable);
    expect(secondo.retryable).toBe(esito.retryable);
    expect(secondo.whatsapp + secondo.sms).toBe(0);
    expect((await env.notifications.listByDate(TEST_DATE)).length).toBe(jobs.length);
  });
});

describe('AppointmentReminderService: promemoria del giorno prima', () => {
  it('anticipa la sync di domani (le pratiche nascono con il codice) e scrive a chi è in attesa domani', async () => {
    const { env, reminders } = setup();
    expect(await env.syncRuns.findLatest(DOMANI)).toBeNull();

    const esito = await reminders.sendPreviousDayReminders(TEST_DATE);
    expect(esito.kind).toBe('REMINDER_PREVIOUS_DAY');
    expect(esito.businessDate).toBe(DOMANI);
    expect(esito.syncStatus).toBe('SUCCESS');
    expect(esito.candidates).toBeGreaterThan(5);
    expect(esito.dryRun).toBe(true);

    const run = await env.syncRuns.findLatest(DOMANI);
    expect(run?.trigger).toBe('REMINDER');
    const domani = await env.appointments.listByDate(DOMANI);
    expect(domani.length).toBe(esito.candidates);
    expect(domani.every((a) => a.code.startsWith('F') && a.businessDate === DOMANI)).toBe(true);

    const jobs = await env.notifications.listByDate(DOMANI);
    expect(jobs.length).toBe(esito.candidates);
    expect(jobs.every((j) => j.kind === 'REMINDER_PREVIOUS_DAY')).toBe(true);
    const job = jobs[0]!;
    expect(job.templateVariables['scheduledDate']).toBe('11/09/2026');
    expect(job.templateVariables['portalUrl']).toContain('/portal?targa=');
    expect(job.renderedText).toContain('domani 11/09/2026');
    expect(job.renderedText).toContain('A domani!');
    expect(job.templateVariables['code']).toBe(job.code);
    // Oggi non è stato toccato: nessun promemoria per la giornata corrente.
    expect(await env.notifications.listByDate(TEST_DATE)).toHaveLength(0);
  });

  it('se la sync di domani fallisce non scrive a nessuno e lo dice', async () => {
    const { env, reminders } = setup({ mode: 'error' });
    const esito = await reminders.sendPreviousDayReminders(TEST_DATE);
    expect(esito.syncStatus).toBe('FAILED');
    expect(esito.candidates).toBe(0);
    expect(esito.skippedReason).toContain('fallita');
    expect(await env.notifications.listByDate(DOMANI)).toHaveLength(0);
  });

  it('con i promemoria disattivati non sincronizza e non scrive', async () => {
    const { env, reminders } = setup({ enabled: false });
    const esito = await reminders.sendPreviousDayReminders(TEST_DATE);
    expect(esito.skippedReason).toContain('REMINDERS_ENABLED');
    expect(await env.syncRuns.findLatest(DOMANI)).toBeNull();
    const stesso = await reminders.sendSameDayReminders(TEST_DATE);
    expect(stesso.skippedReason).toContain('REMINDERS_ENABLED');
  });
});

describe('SyncScheduler: i promemoria scattano alle ore configurate, una volta al giorno', () => {
  function scheduler(clock: MovingClock) {
    const s = setup({ clock });
    const queueService = new QueueService({
      appointments: s.env.appointments,
      referenceData: s.env.referenceData,
      operators: s.env.operators,
      notifications: s.env.notifications,
      crmNotifier: s.env.crmNotifier,
      eventBus: s.env.eventBus,
      clock: s.env.clock,
      ids: s.env.ids,
      logger: s.env.logger,
    });
    const sched = new SyncScheduler({
      syncService: s.syncService,
      syncRuns: s.env.syncRuns,
      queueService,
      appointments: s.env.appointments,
      archive: new InspectionArchiveService({
        appointments: s.env.appointments,
        media: s.env.media,
        mediaStorage: s.env.mediaStorage,
        referenceData: s.env.referenceData,
        clock: s.env.clock,
        logger: s.env.logger,
        hardDeleteDays: 90,
      }),
      clock: s.env.clock,
      logger: s.env.logger,
      syncHourLocal: '06:00',
      businessDayEndLocal: '23:30',
      timeZone: 'Europe/Rome',
      reminders: s.reminders,
      reminderPreviousDayHourLocal: '18:00',
      reminderSameDayHourLocal: '07:30',
    });
    return { ...s, sched };
  }

  it('alle 18 manda il giorno prima; il mattino dopo rifà la sync e alle 07:30 manda il giorno stesso', async () => {
    // 10/09 alle 18:05 di Roma (ora legale: UTC+2).
    const clock = new MovingClock('2026-09-10T16:05:00.000Z');
    const { env, sched } = scheduler(clock);

    await sched.tick('SCHEDULED');
    // Sync di oggi (mai fatta) e promemoria del giorno prima per domani, con sync anticipata.
    expect((await env.syncRuns.findLatest(TEST_DATE))?.trigger).toBe('SCHEDULED');
    expect((await env.syncRuns.findLatest(DOMANI))?.trigger).toBe('REMINDER');
    const jobsDomani = await env.notifications.listByDate(DOMANI);
    expect(jobsDomani.length).toBeGreaterThan(5);
    expect(jobsDomani.every((j) => j.kind === 'REMINDER_PREVIOUS_DAY')).toBe(true);
    // Il primo tick si ferma dopo aver avviato la sync di oggi: il giorno stesso aspetta il tick
    // successivo, quando la sync risulta riuscita (le 07:30 sono passate da ore, quindi parte).
    expect(await env.notifications.listByDate(TEST_DATE)).toHaveLength(0);
    clock.set('2026-09-10T16:06:00.000Z');
    await sched.tick('SCHEDULED');
    const jobsOggi = await env.notifications.listByDate(TEST_DATE);
    expect(jobsOggi.length).toBeGreaterThan(5);
    expect(jobsOggi.every((j) => j.kind === 'REMINDER_SAME_DAY')).toBe(true);

    // Un terzo tick nella stessa giornata non duplica nulla.
    clock.set('2026-09-10T16:07:00.000Z');
    await sched.tick('SCHEDULED');
    expect((await env.notifications.listByDate(DOMANI)).length).toBe(jobsDomani.length);
    expect((await env.notifications.listByDate(TEST_DATE)).length).toBe(jobsOggi.length);

    // 11/09 alle 06:05: la sync anticipata della sera prima NON conta, si rilegge l'agenda.
    clock.set('2026-09-11T04:05:00.000Z');
    await sched.tick('SCHEDULED');
    expect((await env.syncRuns.findLatest(DOMANI))?.trigger).toBe('SCHEDULED');
    // Alle 06:05 il promemoria del giorno stesso non è ancora dovuto.
    expect((await env.notifications.listByDate(DOMANI)).length).toBe(jobsDomani.length);

    // 11/09 alle 07:35: promemoria del giorno stesso per le pratiche di oggi (11/09).
    clock.set('2026-09-11T05:35:00.000Z');
    await sched.tick('SCHEDULED');
    const jobs11 = await env.notifications.listByDate(DOMANI);
    const stesso = jobs11.filter((j) => j.kind === 'REMINDER_SAME_DAY');
    expect(stesso.length).toBeGreaterThan(5);
    expect(stesso.length).toBe(jobs11.length - jobsDomani.length);
    // Ogni pratica ha ricevuto entrambi i promemoria, una volta ciascuno.
    const perPratica = new Map<string, number>();
    for (const j of jobs11) {
      perPratica.set(j.appointmentId, (perPratica.get(j.appointmentId) ?? 0) + 1);
    }
    expect([...perPratica.values()].every((n) => n === 2)).toBe(true);
  });
});
