// Riprova automatica dei messaggi falliti e schermata Comunicazioni.
//
// Il badge «in riprova» deve dire la verità: un invio fallito per un problema temporaneo viene
// davvero ritentato (dopo 1, 5 e 15 minuti), e quando i tentativi finiscono la riga passa a «da
// contattare a mano». Da lì un operatore la prende in carico, telefona e la chiude con l'esito.
import { describe, expect, it } from 'vitest';
import { CommunicationsService } from '@/application/notifications/CommunicationsService';
import {
  NotificationOrchestrator,
  type CommunicationActor,
} from '@/application/notifications/NotificationOrchestrator';
import { NOTIFICATION_RETRY_BACKOFF_MINUTES } from '@/config/constants';
import type { Appointment } from '@/domain/entities/appointment';
import { asOperatorId } from '@/domain/ids';
import type { PhoneE164 } from '@/domain/value-objects/phone';
import { buildTestEnv, makeAppointment, TestClock } from '../helpers/fixtures';

const MINUTO = 60_000;

/** Ultima cifra 8: WhatsApp e SMS vanno in timeout, cioè falliscono in modo ritentabile. */
const TIMEOUT = '+393331234568' as PhoneE164;
const BUONO = '+393331234560' as PhoneE164;

const MARIO: CommunicationActor = {
  operatorId: asOperatorId('op-mario'),
  displayName: 'Mario Rossi',
  privileged: false,
};
const LAURA: CommunicationActor = {
  operatorId: asOperatorId('op-laura'),
  displayName: 'Laura Bianchi',
  privileged: false,
};
const RESPONSABILE: CommunicationActor = {
  operatorId: asOperatorId('op-resp'),
  displayName: 'Responsabile',
  privileged: true,
};

function conTelefono(phone: PhoneE164 | null, whatsappOptIn = true): Appointment {
  const base = makeAppointment();
  return { ...base, customer: { ...base.customer, phone, whatsappOptIn } };
}

async function setup(phone: PhoneE164 | null = TIMEOUT, overrides: Partial<Appointment> = {}) {
  const clock = new TestClock('2026-09-10T08:00:00.000Z');
  const env = buildTestEnv(clock);
  const appointment = { ...conTelefono(phone), ...overrides };
  const inserita = await env.appointments.insert(appointment);
  if (!inserita.ok) {
    throw new Error(inserita.error.message);
  }
  const [brand] = env.seed.brands;
  if (brand === undefined) {
    throw new Error('seed incompleto');
  }
  const run = await env.orchestrator.sendReminder({
    appointment,
    brand,
    kind: 'REMINDER_SAME_DAY',
    correlationId: 'c-retry',
  });
  const communications = new CommunicationsService({
    notifications: env.notifications,
    appointments: env.appointments,
    operators: env.operators,
    orchestrator: env.orchestrator,
    clock,
    logger: env.logger,
  });
  return { env, clock, appointment, job: run.job, run, communications };
}

describe('Riprova automatica dei messaggi falliti', () => {
  it('un timeout su entrambi i canali lascia il job FAILED con il prossimo tentativo fra 1 minuto', async () => {
    const { run, job } = await setup();
    expect(run.outcome.kind).toBe('FAILED_RETRYABLE');
    expect(job.status).toBe('FAILED');
    expect(job.autoRetryCount).toBe(0);
    expect(job.nextAttemptAt).toBe('2026-09-10T08:01:00.000Z');
  });

  it('prima dell’ora prevista non si ritenta; poi 1, 5, 15 minuti e infine «da contattare a mano»', async () => {
    const { env, clock, job } = await setup();

    // Troppo presto: niente da fare.
    clock.advance(30_000);
    expect((await env.orchestrator.retryDue()).attempted).toBe(0);

    let corrente = job;
    for (const [i, minuti] of NOTIFICATION_RETRY_BACKOFF_MINUTES.entries()) {
      clock.advance(minuti * MINUTO);
      const giro = await env.orchestrator.retryDue();
      expect(giro.attempted).toBe(1);
      const dopo = await env.notifications.findJobById(job.id);
      if (dopo === null) {
        throw new Error('job sparito');
      }
      expect(dopo.autoRetryCount).toBe(i + 1);
      expect(dopo.attempts.length).toBeGreaterThan(corrente.attempts.length);
      corrente = dopo;
      if (i < NOTIFICATION_RETRY_BACKOFF_MINUTES.length - 1) {
        expect(dopo.status).toBe('FAILED');
        expect(giro.rescheduled).toBe(1);
        const prossimo = NOTIFICATION_RETRY_BACKOFF_MINUTES[i + 1] ?? 0;
        expect(new Date(dopo.nextAttemptAt ?? '').getTime() - clock.now().getTime()).toBe(
          prossimo * MINUTO,
        );
      } else {
        // Tentativi finiti: nessuna nuova riprova, serve una persona.
        expect(dopo.status).toBe('MANUAL_REQUIRED');
        expect(dopo.nextAttemptAt).toBeNull();
        expect(giro.manualRequired).toBe(1);
      }
    }

    clock.advance(60 * MINUTO);
    expect((await env.orchestrator.retryDue()).attempted).toBe(0);
  });

  it('se nel frattempo il guasto passa, la riprova consegna il messaggio', async () => {
    const { env, clock, job } = await setup();
    // Il numero viene corretto in agenda (qui: direttamente sul job) e il provider torna a rispondere.
    await env.notifications.updateJob({ ...job, recipientPhone: BUONO });
    clock.advance(MINUTO);
    const giro = await env.orchestrator.retryDue();
    expect(giro.sent).toBe(1);
    const dopo = await env.notifications.findJobById(job.id);
    // Il finto Spoki consegna subito: SENT o già DELIVERED, comunque arrivato.
    expect(['SENT', 'DELIVERED']).toContain(dopo?.status);
    expect(dopo?.nextAttemptAt).toBeNull();
  });

  it('un messaggio di un giorno passato non si manda più: la riprova si ferma e resta da gestire', async () => {
    const { env, clock, job } = await setup();
    await env.notifications.updateJob({ ...job, businessDate: '2026-09-09' as never });
    clock.advance(MINUTO);
    const giro = await env.orchestrator.retryDue();
    expect(giro).toMatchObject({ attempted: 0, skipped: 1 });
    const dopo = await env.notifications.findJobById(job.id);
    expect(dopo?.status).toBe('FAILED');
    expect(dopo?.nextAttemptAt).toBeNull();
  });

  it('un invio rimasto a metà (IN_FLIGHT orfano dopo un riavvio) viene ripreso', async () => {
    const { env, clock, job } = await setup(BUONO);
    await env.notifications.updateJob({ ...job, status: 'IN_FLIGHT', nextAttemptAt: null });
    clock.advance(10 * MINUTO);
    const giro = await env.orchestrator.retryDue();
    expect(giro.attempted).toBe(1);
    expect(['SENT', 'DELIVERED']).toContain((await env.notifications.findJobById(job.id))?.status);
  });

  it('un WhatsApp dato per non consegnato dal webhook passa all’SMS alla prima riprova', async () => {
    const { env, clock, job } = await setup(BUONO);
    expect(job.currentChannel).toBe('WHATSAPP');
    const idMessaggio = job.attempts.find((a) => a.channel === 'WHATSAPP')?.providerMessageId;
    if (idMessaggio === null || idMessaggio === undefined) {
      throw new Error('nessun tentativo WhatsApp');
    }
    const fallito = await env.orchestrator.applyDeliveryStatus(
      job,
      {
        providerMessageId: idMessaggio,
        state: 'FAILED',
        reason: 'numero non su WhatsApp',
        at: clock.nowIso(),
      },
      'c-webhook',
    );
    expect(fallito.status).toBe('FAILED');
    expect(fallito.nextAttemptAt).not.toBeNull();

    const giro = await env.orchestrator.retryDue();
    expect(giro.sent).toBe(1);
    const dopo = await env.notifications.findJobById(job.id);
    expect(dopo?.currentChannel).toBe('SMS');
    // Il WhatsApp fallito in modo definitivo non si ritenta: si va dritti all'SMS.
    expect(dopo?.attempts.map((a) => a.channel)).toEqual(['WHATSAPP', 'SMS']);
  });
});

describe('Schermata Comunicazioni', () => {
  it('elenca il messaggio in riprova con l’ora del prossimo tentativo e lo conta a parte', async () => {
    const { communications, appointment } = await setup();
    const vista = await communications.list('open', { operatorId: MARIO.operatorId });
    expect(vista.retryingCount).toBe(1);
    expect(vista.openCount).toBe(0);
    const [riga] = vista.rows;
    expect(riga?.code).toBe(appointment.code);
    expect(riga?.plate).toBe(appointment.vehicle.plate);
    expect(riga?.phone).toBe(TIMEOUT);
    expect(riga?.nextAttemptAt).toBe('2026-09-10T08:01:00.000Z');
    expect(riga?.lastError).toMatch(/^SMS: /);
  });

  it('«Prendo io» blocca i colleghi; rilascia chi l’ha presa o un responsabile', async () => {
    const { communications, job } = await setup();
    const presa = await communications.act(job.id, { action: 'claim' }, MARIO);
    expect(presa.ok && presa.value.claimedByName).toBe('Mario Rossi');
    expect(presa.ok && presa.value.claimedByMe).toBe(true);

    const collega = await communications.act(job.id, { action: 'claim' }, LAURA);
    expect(!collega.ok && collega.error.code).toBe('VERSION_CONFLICT');
    const rilascioCollega = await communications.act(job.id, { action: 'release' }, LAURA);
    expect(!rilascioCollega.ok && rilascioCollega.error.code).toBe('INVALID_TRANSITION');

    // Ripremere è innocuo.
    expect((await communications.act(job.id, { action: 'claim' }, MARIO)).ok).toBe(true);

    const rilascio = await communications.act(job.id, { action: 'release' }, RESPONSABILE);
    expect(rilascio.ok && rilascio.value.claimedByName).toBeNull();
    expect((await communications.act(job.id, { action: 'claim' }, LAURA)).ok).toBe(true);
  });

  it('registrare l’esito chiude la segnalazione, ferma le riprove e la sposta fra le gestite', async () => {
    const { communications, env, clock, job } = await setup();
    const chiusa = await communications.act(
      job.id,
      { action: 'confirm', outcome: 'PHONE_CALLED', note: '  arriva alle 11  ' },
      MARIO,
    );
    expect(chiusa.ok).toBe(true);
    if (!chiusa.ok) {
      return;
    }
    expect(chiusa.value.status).toBe('MANUAL_CONFIRMED');
    expect(chiusa.value.manualOutcomeLabel).toBe('Cliente chiamato al telefono');
    expect(chiusa.value.manualNote).toBe('arriva alle 11');
    expect(chiusa.value.claimedByName).toBe('Mario Rossi');

    clock.advance(MINUTO);
    expect((await env.orchestrator.retryDue()).attempted).toBe(0);

    const aperte = await communications.list('open', { operatorId: MARIO.operatorId });
    expect(aperte.rows).toHaveLength(0);
    const gestite = await communications.list('handled', { operatorId: MARIO.operatorId });
    expect(gestite.rows.map((r) => r.jobId)).toEqual([job.id]);
    expect(gestite.handledTodayCount).toBe(1);

    // Una segnalazione chiusa non si prende più in carico.
    const dopo = await communications.act(job.id, { action: 'claim' }, LAURA);
    expect(!dopo.ok && dopo.error.code).toBe('INVALID_TRANSITION');
  });

  it('senza numero non si riprova l’invio: si informa il cliente di persona e si chiude', async () => {
    const { communications, job } = await setup(null);
    expect(job.status).toBe('NO_RECIPIENT');
    const vista = await communications.list('open', { operatorId: MARIO.operatorId });
    expect(vista.openCount).toBe(1);

    const riprova = await communications.act(job.id, { action: 'retry' }, MARIO);
    expect(!riprova.ok && riprova.error.code).toBe('NO_RECIPIENT');

    const chiusa = await communications.act(
      job.id,
      { action: 'confirm', outcome: 'INFORMED_AT_DESK', note: null },
      MARIO,
    );
    expect(chiusa.ok && chiusa.value.status).toBe('MANUAL_CONFIRMED');
  });

  it('una nota oltre i 500 caratteri viene rifiutata senza chiudere niente', async () => {
    const { communications, job } = await setup();
    const troppo = await communications.act(
      job.id,
      { action: 'confirm', outcome: 'OTHER', note: 'x'.repeat(501) },
      MARIO,
    );
    expect(!troppo.ok && troppo.error.code).toBe('VALIDATION');
  });
});

describe('Riprova automatica: i casi trovati in revisione', () => {
  it('il promemoria del giorno prima (data di domani) si ritenta come gli altri', async () => {
    const { env, clock, job } = await setup(TIMEOUT, {
      businessDate: '2026-09-11' as never,
      scheduledAt: '2026-09-11T07:00:00.000Z' as never,
    });
    expect(job.businessDate).toBe('2026-09-11');
    expect(job.status).toBe('FAILED');
    clock.advance(MINUTO);
    const giro = await env.orchestrator.retryDue();
    expect(giro).toMatchObject({ attempted: 1, skipped: 0 });
    expect((await env.notifications.findJobById(job.id))?.autoRetryCount).toBe(1);
  });

  it('un invio rimasto a metà in una giornata passata diventa «da contattare a mano», una volta sola', async () => {
    const { env, clock, job } = await setup(BUONO);
    await env.notifications.updateJob({
      ...job,
      status: 'IN_FLIGHT',
      businessDate: '2026-09-09' as never,
      nextAttemptAt: null,
    });
    clock.advance(10 * MINUTO);
    expect((await env.orchestrator.retryDue()).skipped).toBe(1);
    expect((await env.notifications.findJobById(job.id))?.status).toBe('MANUAL_REQUIRED');
    clock.advance(10 * MINUTO);
    expect((await env.orchestrator.retryDue()).skipped).toBe(0);
  });

  it('con la riprova spenta un fallimento temporaneo non promette tentativi: è subito da gestire', async () => {
    const clock = new TestClock('2026-09-10T08:00:00.000Z');
    const env = buildTestEnv(clock);
    const orchestrator = new NotificationOrchestrator({
      spoki: env.spoki,
      smsHosting: env.smsHosting,
      notifications: env.notifications,
      clock,
      ids: env.ids,
      logger: env.logger,
      eventBus: env.eventBus,
      autoRetry: false,
    });
    const [brand] = env.seed.brands;
    if (brand === undefined) {
      throw new Error('seed incompleto');
    }
    const run = await orchestrator.sendReminder({
      appointment: conTelefono(TIMEOUT),
      brand,
      kind: 'REMINDER_SAME_DAY',
      correlationId: 'c-spenta',
    });
    expect(run.job.status).toBe('MANUAL_REQUIRED');
    expect(run.job.nextAttemptAt).toBeNull();
  });

  it('un messaggio di un giorno passato non si rimanda nemmeno a mano', async () => {
    const { env, communications, job } = await setup();
    await env.notifications.updateJob({ ...job, businessDate: '2026-09-09' as never });
    const riprova = await communications.act(job.id, { action: 'retry' }, MARIO);
    expect(!riprova.ok && riprova.error.code).toBe('INVALID_TRANSITION');
  });

  it('il contatto preso da un collega non si riprova né si chiude; un responsabile sì', async () => {
    const { communications, job } = await setup();
    expect((await communications.act(job.id, { action: 'claim' }, MARIO)).ok).toBe(true);
    const riprova = await communications.act(job.id, { action: 'retry' }, LAURA);
    expect(!riprova.ok && riprova.error.code).toBe('VERSION_CONFLICT');
    const chiusa = await communications.act(
      job.id,
      { action: 'confirm', outcome: 'PHONE_CALLED', note: null },
      LAURA,
    );
    expect(!chiusa.ok && chiusa.error.code).toBe('VERSION_CONFLICT');
    const responsabile = await communications.act(
      job.id,
      { action: 'confirm', outcome: 'PHONE_CALLED', note: null },
      RESPONSABILE,
    );
    expect(responsabile.ok && responsabile.value.status).toBe('MANUAL_CONFIRMED');
    // Chiusa, non si rilascia più: la presa in carico resta scritta con l'esito.
    const rilascio = await communications.act(job.id, { action: 'release' }, RESPONSABILE);
    expect(!rilascio.ok && rilascio.error.code).toBe('INVALID_TRANSITION');
  });
});
