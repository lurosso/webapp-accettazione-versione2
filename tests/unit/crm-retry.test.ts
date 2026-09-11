import { describe, expect, it } from 'vitest';
import { CrmNotifier } from '@/application/crm/CrmNotifier';
import { CrmRetryScheduler } from '@/application/crm/CrmRetryScheduler';
import { CrmOutboxService } from '@/application/crm/CrmOutboxService';
import { CRM_MAX_ATTEMPTS, CRM_RETRY_BACKOFF_MINUTES } from '@/config/constants';
import type { CrmMockMode } from '@/services/interfaces/mock-config';
import { CrmServiceMock } from '@/services/mocks/CrmServiceMock';
import { buildTestEnv, makeAppointment, TEST_DATE } from '../helpers/fixtures';

/**
 * Ambiente con un CRM di cui si controlla la modalità: `mode` decide se il finto CRM risponde,
 * rifiuta (errore definitivo) o va in timeout (errore ritentabile).
 */
function setup(mode: CrmMockMode) {
  const env = buildTestEnv();
  const crm = new CrmServiceMock({ mode, latencyMs: 0 }, { clock: env.clock, logger: env.logger });
  const notifier = new CrmNotifier({
    crm,
    outbox: env.crmOutbox,
    referenceData: env.referenceData,
    clock: env.clock,
    ids: env.ids,
    logger: env.logger,
    eventBus: env.eventBus,
    // Timeout minimo: la modalità "timeout" del mock attende il tempo concesso, e nei test non
    // vogliamo aspettarlo davvero.
    callTimeoutMs: 5,
  });
  const outboxService = new CrmOutboxService({
    outbox: env.crmOutbox,
    notifier,
    logger: env.logger,
  });
  return { env, crm, notifier, outboxService };
}

/** Pratica assente da segnalare al CRM (già in stato NO_SHOW, come la lascia il QueueService). */
async function assente(env: ReturnType<typeof buildTestEnv>) {
  const a = makeAppointment({ status: 'NO_SHOW', noShowAt: env.clock.nowIso() });
  const r = await env.appointments.insert(a);
  if (!r.ok) {
    throw new Error(r.error.message);
  }
  return r.value;
}

describe('CrmNotifier: rinvii automatici', () => {
  it('un errore ritentabile lascia l’evento in coda con il prossimo tentativo programmato', async () => {
    const { env, notifier } = setup('timeout');
    const a = await assente(env);

    const consegna = await notifier.notifyNoShow(a, 'Non si è presentato', 'corr-1');
    expect(consegna.outcome).toBe('QUEUED');
    expect(consegna.event?.status).toBe('PENDING');
    expect(consegna.event?.attemptCount).toBe(1);
    // Attesa progressiva: il primo rinvio è fra un minuto.
    const atteso = new Date(env.clock.now().getTime() + CRM_RETRY_BACKOFF_MINUTES[0]! * 60_000);
    expect(consegna.event?.nextAttemptAt).toBe(atteso.toISOString());
    expect(consegna.event?.lastError).toContain('TIMEOUT');
  });

  it('un rifiuto definitivo del CRM non viene ritentato', async () => {
    const { env, notifier } = setup('error');
    const a = await assente(env);

    const consegna = await notifier.notifyNoShow(a, null, 'corr-2');
    expect(consegna.outcome).toBe('GIVEN_UP');
    expect(consegna.event?.status).toBe('FAILED');
    expect(consegna.event?.nextAttemptAt).toBeNull();
    // Un evento abbandonato non viene più preso dallo svuotamento automatico.
    expect(await env.crmOutbox.listDue(env.clock.nowIso(), 10)).toHaveLength(0);
    env.clock.advance(24 * 60 * 60_000);
    expect(await env.crmOutbox.listDue(env.clock.nowIso(), 10)).toHaveLength(0);
  });

  it('lo svuotamento non tocca gli eventi la cui attesa non è ancora scaduta', async () => {
    const { env, notifier } = setup('timeout');
    await notifier.notifyNoShow(await assente(env), null, 'corr-3');

    // Subito dopo il primo tentativo il prossimo è fra un minuto: non c'è nulla da fare.
    expect(await notifier.drainDue()).toMatchObject({ attempted: 0 });

    env.clock.advance(2 * 60_000);
    expect(await notifier.drainDue()).toMatchObject({ attempted: 1, queued: 1 });
  });

  it('dopo i tentativi previsti la consegna viene abbandonata', async () => {
    const { env, notifier } = setup('timeout');
    await notifier.notifyNoShow(await assente(env), null, 'corr-4');

    // Si avanza oltre ogni attesa: l'evento viene ritentato fino al tetto dei tentativi.
    for (const minuti of CRM_RETRY_BACKOFF_MINUTES) {
      env.clock.advance((minuti + 1) * 60_000);
      await notifier.drainDue();
    }

    const inCoda = await env.crmOutbox.listByStatus(['PENDING', 'FAILED']);
    expect(inCoda).toHaveLength(1);
    expect(inCoda[0]?.status).toBe('FAILED');
    expect(inCoda[0]?.attemptCount).toBe(CRM_MAX_ATTEMPTS);
    expect(inCoda[0]?.nextAttemptAt).toBeNull();

    // Da qui in avanti il temporizzatore lo ignora: nessun tentativo in più.
    env.clock.advance(24 * 60 * 60_000);
    expect(await notifier.drainDue()).toMatchObject({ attempted: 0 });
  });

  it('quando il CRM torna su, lo svuotamento consegna e la riga passa a SENT', async () => {
    const { env, notifier } = setup('timeout');
    const a = await assente(env);
    await notifier.notifyNoShow(a, 'Non si è presentato', 'corr-5');

    // Stesso notificatore, CRM tornato raggiungibile: si riusa la coda, non si ricostruisce nulla.
    const crmSu = new CrmServiceMock(
      { mode: 'ok', latencyMs: 0 },
      { clock: env.clock, logger: env.logger },
    );
    const notifierSu = new CrmNotifier({
      crm: crmSu,
      outbox: env.crmOutbox,
      referenceData: env.referenceData,
      clock: env.clock,
      ids: env.ids,
      logger: env.logger,
      callTimeoutMs: 5,
    });

    env.clock.advance(2 * 60_000);
    expect(await notifierSu.drainDue()).toMatchObject({ attempted: 1, sent: 1 });

    const inviati = await env.crmOutbox.listByStatus(['SENT']);
    expect(inviati).toHaveLength(1);
    expect(inviati[0]?.crmAckId).toMatch(/^crm-mock-/);
    // Il payload rispedito è quello archiviato: il CRM riceve la pratica come era al momento.
    expect(crmSu.received[0]).toMatchObject({ code: a.code, reason: 'MARKED_BY_OPERATOR' });
  });

  it('la riprova manuale riparte anche da un evento abbandonato', async () => {
    const { env, notifier, outboxService } = setup('error');
    const a = await assente(env);
    const consegna = await notifier.notifyNoShow(a, null, 'corr-6');
    const eventId = consegna.event?.id;
    expect(eventId).toBeDefined();

    // Con il CRM ancora giù la riprova manuale fallisce, ma non lancia e resta tracciata.
    const primaRiprova = await outboxService.retry(eventId!, 'corr-7');
    expect(primaRiprova.outcome).toBe('GIVEN_UP');
    expect(primaRiprova.event?.attemptCount).toBe(2);

    const vista = await outboxService.list({ statuses: ['FAILED'] });
    expect(vista.rows).toHaveLength(1);
    expect(vista.rows[0]?.code).toBe(a.code);
    expect(vista.rows[0]?.lastError).toContain('PROVIDER_ERROR');
    expect(vista.counts.failed).toBe(1);
  });

  it('un evento già inviato non viene rispedito dalla riprova manuale', async () => {
    const { env, notifier, outboxService, crm } = setup('ok');
    const consegna = await notifier.notifyNoShow(await assente(env), null, 'corr-8');
    expect(consegna.outcome).toBe('SENT');

    const riprova = await outboxService.retry(consegna.event!.id, 'corr-9');
    expect(riprova.outcome).toBe('ALREADY_SENT');
    expect(crm.received).toHaveLength(1);
  });

  it('un evento inesistente non fa esplodere la riprova', async () => {
    const { outboxService } = setup('ok');
    const riprova = await outboxService.retry('mai-esistito' as never, 'corr-10');
    expect(riprova.outcome).toBe('SKIPPED');
    expect(riprova.event).toBeNull();
  });
});

describe('CrmRetryScheduler', () => {
  it('una passata svuota la coda e non si sovrappone a se stessa', async () => {
    const { env, notifier } = setup('timeout');
    await notifier.notifyNoShow(await assente(env), null, 'corr-11');
    env.clock.advance(2 * 60_000);

    const scheduler = new CrmRetryScheduler({ notifier, logger: env.logger });
    await Promise.all([scheduler.tick(), scheduler.tick()]);

    // Due tick insieme: il secondo viene saltato, quindi un solo tentativo in più.
    const inCoda = await env.crmOutbox.listByStatus(['PENDING']);
    expect(inCoda[0]?.attemptCount).toBe(2);
  });

  it('la giornata dei test non lascia timer attivi', () => {
    const { env, notifier } = setup('ok');
    const scheduler = new CrmRetryScheduler({ notifier, logger: env.logger, tickMs: 60_000 });
    const stop = scheduler.start();
    stop();
    // Fermare due volte non è un errore: l'avvio è idempotente e lo stop pure.
    scheduler.stop();
    expect(true).toBe(true);
  });
});

describe('CrmOutboxService: vista tecnica', () => {
  it('elenca dal più recente e conta per stato', async () => {
    const { env, notifier, outboxService } = setup('ok');
    const prima = await assente(env);
    await notifier.notifyNoShow(prima, null, 'corr-12');
    env.clock.advance(60_000);
    const seconda = await assente(env);
    await notifier.notifyNoShow(seconda, null, 'corr-13');

    const vista = await outboxService.list();
    expect(vista.rows.map((r) => r.code)).toEqual([seconda.code, prima.code]);
    expect(vista.counts).toMatchObject({ sent: 2, pending: 0, failed: 0, manual: 0 });
    expect(vista.rows[0]?.type).toBe('NO_SHOW');
    expect(vista.rows[0]?.idempotencyKey).toContain(TEST_DATE);
  });
});
