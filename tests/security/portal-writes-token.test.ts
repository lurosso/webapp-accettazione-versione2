// Portale cliente: con PORTAL_WRITES_REQUIRE_TOKEN le scritture («Sono qui», «In ritardo») valgono
// solo con il link personale; la sola targa consulta e basta. Il canale WhatsApp resta libero.
import { describe, expect, it } from 'vitest';
import { CustomerPortalService } from '@/application/portal/CustomerPortalService';
import { createPortalTokenFactory, derivePortalTokenKey } from '@/application/portal/portal-token';
import type { Appointment } from '@/domain/entities/appointment';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import { buildTestEnv, makeAppointment, TestClock } from '../helpers/fixtures';

const AT = (hhmm: string) => `2026-09-10T${hhmm}:00.000Z` as IsoDateTime;

function setup(writesRequireToken: boolean) {
  const clock = new TestClock('2026-09-10T07:00:00.000Z');
  const env = buildTestEnv(clock);
  const tokens = createPortalTokenFactory(
    derivePortalTokenKey('segreto-di-prova-abbastanza-lungo-per-i-test'),
  );
  const service = new CustomerPortalService({
    appointments: env.appointments,
    referenceData: env.referenceData,
    operators: env.operators,
    eventBus: env.eventBus,
    clock,
    ids: env.ids,
    logger: env.logger,
    tokens,
    writesRequireToken,
  });
  return { env, tokens, service };
}

async function insert(env: ReturnType<typeof buildTestEnv>, a: Appointment): Promise<Appointment> {
  const r = await env.appointments.insert(a);
  if (!r.ok) {
    throw new Error(r.error.message);
  }
  return r.value;
}

describe('Sicurezza portale: scritture solo con il token del link', () => {
  it('con la sola targa si consulta ma non si registra l’arrivo né il ritardo', async () => {
    const { env, service } = setup(true);
    const a = await insert(env, makeAppointment({ scheduledAt: AT('08:00') }));

    expect((await service.getStatus({ plate: a.vehicle.plate })).ok).toBe(true);

    const arrivo = await service.registerArrival({ plate: a.vehicle.plate }, 'PORTAL');
    expect(!arrivo.ok && arrivo.error.code).toBe('NOT_FOUND');
    const ritardo = await service.reportDelay({ plate: a.vehicle.plate }, 15);
    expect(!ritardo.ok && ritardo.error.code).toBe('NOT_FOUND');

    const dopo = await env.appointments.findById(a.id);
    expect(dopo?.customerArrivedAt).toBeNull();
    expect(dopo?.customerLateNoticeAt).toBeNull();
  });

  it('un token sbagliato con la targa giusta non scrive: niente ripiego sulla targa', async () => {
    const { env, service } = setup(true);
    const a = await insert(env, makeAppointment({ scheduledAt: AT('08:00') }));
    const arrivo = await service.registerArrival(
      { plate: a.vehicle.plate, token: 'ffffffffffffffff' },
      'PORTAL',
    );
    expect(!arrivo.ok && arrivo.error.code).toBe('NOT_FOUND');
    expect((await env.appointments.findById(a.id))?.customerArrivedAt).toBeNull();
  });

  it('con il token personale l’arrivo si registra; via WhatsApp basta la targa (il numero identifica già)', async () => {
    const { env, service, tokens } = setup(true);
    const a = await insert(env, makeAppointment({ scheduledAt: AT('08:00') }));
    const conToken = await service.registerArrival(
      { token: tokens.forAppointment(a.id) },
      'PORTAL',
    );
    expect(conToken.ok && conToken.value.registered).toBe(true);

    const b = await insert(env, makeAppointment({ scheduledAt: AT('08:30') }));
    const daWhatsapp = await service.registerArrival({ plate: b.vehicle.plate }, 'WHATSAPP');
    expect(daWhatsapp.ok && daWhatsapp.value.registered).toBe(true);
  });

  it('con il flag spento la targa basta, come dal QR (comportamento attuale, documentato)', async () => {
    const { env, service } = setup(false);
    const a = await insert(env, makeAppointment({ scheduledAt: AT('08:00') }));
    const arrivo = await service.registerArrival({ plate: a.vehicle.plate }, 'PORTAL');
    expect(arrivo.ok && arrivo.value.registered).toBe(true);
  });

  it('la chiave dei token è derivata dal segreto di sessione, non il segreto stesso', () => {
    const segreto = 'segreto-di-prova-abbastanza-lungo-per-i-test';
    const derivata = derivePortalTokenKey(segreto);
    expect(derivata).not.toBe(segreto);
    expect(derivata).toMatch(/^[0-9a-f]{64}$/);
    expect(derivePortalTokenKey(segreto)).toBe(derivata);
    const a = makeAppointment();
    expect(createPortalTokenFactory(derivata).forAppointment(a.id)).not.toBe(
      createPortalTokenFactory(segreto).forAppointment(a.id),
    );
  });
});
