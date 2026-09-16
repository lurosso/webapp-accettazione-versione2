import { describe, expect, it } from 'vitest';
import { NotificationOrchestrator } from '@/application/notifications/NotificationOrchestrator';
import type { PhoneE164 } from '@/domain/value-objects/phone';
import { buildTestEnv, makeAppointment } from '../helpers/fixtures';

/** Orchestratore con o senza l'override del consenso (SPOKI_OVERRIDE_CONSENT). */
function orchestrator(env: ReturnType<typeof buildTestEnv>, whatsappConsentOverride: boolean) {
  return new NotificationOrchestrator({
    spoki: env.spoki,
    smsHosting: env.smsHosting,
    notifications: env.notifications,
    clock: env.clock,
    ids: env.ids,
    logger: env.logger,
    eventBus: env.eventBus,
    whatsappConsentOverride,
  });
}

describe('Promemoria e consenso WhatsApp (SPOKI_OVERRIDE_CONSENT)', () => {
  it("senza override un cliente senza opt-in in anagrafica riceve l'SMS", async () => {
    const env = buildTestEnv();
    const brand = env.seed.brands[0]!;
    const senzaConsenso = makeAppointment({
      customer: {
        ...makeAppointment().customer,
        whatsappOptIn: false,
        phone: '+393331234560' as PhoneE164,
      },
    });
    const run = await orchestrator(env, false).sendReminder({
      appointment: senzaConsenso,
      brand,
      kind: 'REMINDER_SAME_DAY',
      correlationId: 'test-senza-override',
    });
    expect(run.outcome.kind).toBe('SMS_FALLBACK_SENT');
    expect(run.job.whatsappOptIn).toBe(false);
    expect(run.job.currentChannel).toBe('SMS');
  });

  it('con override il promemoria (comunicazione di servizio) tenta WhatsApp anche senza opt-in', async () => {
    const env = buildTestEnv();
    const brand = env.seed.brands[0]!;
    const senzaConsenso = makeAppointment({
      customer: {
        ...makeAppointment().customer,
        whatsappOptIn: false,
        phone: '+393331234561' as PhoneE164,
      },
    });
    const run = await orchestrator(env, true).sendReminder({
      appointment: senzaConsenso,
      brand,
      kind: 'REMINDER_SAME_DAY',
      correlationId: 'test-con-override',
    });
    expect(run.outcome.kind).toBe('WHATSAPP_SENT');
    expect(run.job.whatsappOptIn).toBe(true);
    expect(run.job.currentChannel).toBe('WHATSAPP');
  });

  it("l'override non toglie il ripiego: se WhatsApp fallisce si passa comunque all'SMS", async () => {
    const env = buildTestEnv();
    const brand = env.seed.brands[0]!;
    // Regola del mock Spoki: numero che finisce per 9 → WhatsApp rifiutato.
    const rifiutato = makeAppointment({
      customer: {
        ...makeAppointment().customer,
        whatsappOptIn: false,
        phone: '+393331234569' as PhoneE164,
      },
    });
    const run = await orchestrator(env, true).sendReminder({
      appointment: rifiutato,
      brand,
      kind: 'REMINDER_PREVIOUS_DAY',
      correlationId: 'test-ripiego',
    });
    expect(run.outcome.kind).toBe('SMS_FALLBACK_SENT');
    expect(run.job.attempts.map((a) => a.channel)).toEqual(['WHATSAPP', 'SMS']);
  });
});
