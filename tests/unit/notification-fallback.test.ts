import { describe, expect, it } from 'vitest';
import type { Appointment } from '@/domain/entities/appointment';
import type { PhoneE164 } from '@/domain/value-objects/phone';
import { buildTestEnv, makeAppointment, TEST_DATE } from '../helpers/fixtures';

/** Numero con l'ultima cifra indicata: è la cifra a decidere l'esito nei mock. */
const phoneEndingIn = (suffix: string): PhoneE164 =>
  `+3933312345${suffix.padStart(2, '6')}` as PhoneE164;

function appointmentWithPhone(phone: PhoneE164 | null, whatsappOptIn = true): Appointment {
  const base = makeAppointment();
  return { ...base, customer: { ...base.customer, phone, whatsappOptIn } };
}

describe('NotificationOrchestrator: WhatsApp con ripiego su SMS', () => {
  it('numero che finisce per 0: promemoria inviato via WhatsApp', async () => {
    const env = buildTestEnv();
    const [brand] = env.seed.brands;
    if (brand === undefined) {
      throw new Error('seed incompleto');
    }
    const appointment = appointmentWithPhone(phoneEndingIn('60'));

    const run = await env.orchestrator.sendReminder({
      appointment,
      brand,
      kind: 'REMINDER_MORNING',
      correlationId: 'c1',
    });

    expect(run.outcome.kind).toBe('WHATSAPP_SENT');
    expect(run.job.currentChannel).toBe('WHATSAPP');
    expect(run.job.attempts).toHaveLength(1);
    expect(run.job.attempts[0]?.provider).toBe('SPOKI');
    // Il testo contiene il codice progressivo, che è ciò che il cliente dovrà esibire.
    expect(run.job.renderedText).toContain(appointment.code);
  });

  it("numero che finisce per 9: WhatsApp rifiutato, l'SMS parte da solo", async () => {
    const env = buildTestEnv();
    const [brand] = env.seed.brands;
    if (brand === undefined) {
      throw new Error('seed incompleto');
    }
    const appointment = appointmentWithPhone(phoneEndingIn('9'));

    const run = await env.orchestrator.sendReminder({
      appointment,
      brand,
      kind: 'REMINDER_MORNING',
      correlationId: 'c2',
    });

    expect(run.outcome.kind).toBe('SMS_FALLBACK_SENT');
    expect(run.job.currentChannel).toBe('SMS');
    // Due tentativi registrati: il WhatsApp fallito e l'SMS riuscito.
    expect(run.job.attempts.map((a) => a.channel)).toEqual(['WHATSAPP', 'SMS']);
    expect(run.job.attempts[0]?.outcome).toBe('FAILED');
    expect(run.job.attempts[1]?.outcome).toBe('SENT');
  });

  it('numero che finisce per 99: falliscono entrambi i canali, serve il contatto manuale', async () => {
    const env = buildTestEnv();
    const [brand] = env.seed.brands;
    if (brand === undefined) {
      throw new Error('seed incompleto');
    }
    const appointment = appointmentWithPhone(phoneEndingIn('99'));

    const run = await env.orchestrator.sendReminder({
      appointment,
      brand,
      kind: 'REMINDER_MORNING',
      correlationId: 'c3',
    });

    expect(run.outcome.kind).toBe('MANUAL_REQUIRED');
    expect(run.job.status).toBe('MANUAL_REQUIRED');

    // Il responsabile chiude il cerchio dicendo di aver telefonato al cliente.
    const confirmed = await env.orchestrator.confirmManual(
      run.job.id,
      env.seed.operators[0]?.id ?? ('op-admin' as never),
      'Cliente avvisato al telefono',
    );
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) {
      expect(confirmed.value.status).toBe('MANUAL_CONFIRMED');
    }
  });

  it('senza numero di telefono la notifica è segnata come non inviabile', async () => {
    const env = buildTestEnv();
    const [brand] = env.seed.brands;
    if (brand === undefined) {
      throw new Error('seed incompleto');
    }
    const run = await env.orchestrator.sendReminder({
      appointment: appointmentWithPhone(null),
      brand,
      kind: 'REMINDER_MORNING',
      correlationId: 'c4',
    });
    expect(run.outcome.kind).toBe('NO_RECIPIENT');
    expect(run.job.status).toBe('NO_RECIPIENT');
  });

  it("cliente senza consenso WhatsApp: si usa direttamente l'SMS", async () => {
    const env = buildTestEnv();
    const [brand] = env.seed.brands;
    if (brand === undefined) {
      throw new Error('seed incompleto');
    }
    const run = await env.orchestrator.sendReminder({
      appointment: appointmentWithPhone(phoneEndingIn('60'), false),
      brand,
      kind: 'REMINDER_MORNING',
      correlationId: 'c5',
    });
    expect(run.outcome.kind).toBe('SMS_FALLBACK_SENT');
    expect(run.job.attempts.map((a) => a.channel)).toEqual(['SMS']);
  });

  it('due invii per la stessa pratica e giornata non producono due messaggi', async () => {
    const env = buildTestEnv();
    const [brand] = env.seed.brands;
    if (brand === undefined) {
      throw new Error('seed incompleto');
    }
    const appointment = appointmentWithPhone(phoneEndingIn('60'));
    const input = {
      appointment,
      brand,
      kind: 'REMINDER_MORNING' as const,
      correlationId: 'c6',
    };
    const first = await env.orchestrator.sendReminder(input);
    const second = await env.orchestrator.sendReminder(input);

    expect(first.outcome.kind).toBe('WHATSAPP_SENT');
    expect(second.outcome.kind).toBe('ALREADY_PROCESSED');
    const jobs = await env.notifications.listByDate(TEST_DATE);
    expect(jobs).toHaveLength(1);
  });

  it('sendMorningReminders elabora tutte le pratiche e non si ferma al primo errore', async () => {
    const env = buildTestEnv();
    const brands = env.seed.brands;
    const appointments = [
      appointmentWithPhone(phoneEndingIn('60')),
      appointmentWithPhone(phoneEndingIn('9')),
      appointmentWithPhone(phoneEndingIn('99')),
      appointmentWithPhone(null),
    ];

    const runs = await env.orchestrator.sendMorningReminders({
      appointments,
      brands,
      correlationId: 'mattina',
    });

    expect(runs.map((r) => r.outcome.kind)).toEqual([
      'WHATSAPP_SENT',
      'SMS_FALLBACK_SENT',
      'MANUAL_REQUIRED',
      'NO_RECIPIENT',
    ]);
  });
});
