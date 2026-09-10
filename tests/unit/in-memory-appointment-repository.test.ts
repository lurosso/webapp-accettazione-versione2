import { describe, expect, it } from 'vitest';
import { asDeskId } from '@/domain/ids';
import { buildTestEnv, makeAppointment, TEST_DATE } from '../helpers/fixtures';

describe('InMemoryAppointmentRepository', () => {
  it('insert rifiuta duplicati di id, codice ed externalRef nella giornata', async () => {
    const env = buildTestEnv();
    const a = makeAppointment();
    expect((await env.appointments.insert(a)).ok).toBe(true);

    const sameId = await env.appointments.insert(a);
    expect(sameId.ok).toBe(false);

    const sameCode = await env.appointments.insert(
      makeAppointment({ code: a.code, sequence: a.sequence }),
    );
    expect(sameCode.ok).toBe(false);

    const sameRef = await env.appointments.insert(makeAppointment({ externalRef: a.externalRef }));
    expect(sameRef.ok).toBe(false);
    if (!sameRef.ok) {
      expect(sameRef.error.code).toBe('VALIDATION');
    }
  });

  it('update con expectedVersion errato → VERSION_CONFLICT con la pratica corrente nei dettagli', async () => {
    const env = buildTestEnv();
    const a = makeAppointment();
    await env.appointments.insert(a);

    const first = await env.appointments.update({ ...a, notes: 'prima' }, 1);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.value.version).toBe(2);
    }

    const stale = await env.appointments.update({ ...a, notes: 'seconda' }, 1);
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.error.code).toBe('VERSION_CONFLICT');
      expect(stale.error.details?.['currentVersion']).toBe(2);
    }
  });

  it('reserveNextSequence è monotono per giornata e prefisso', async () => {
    const env = buildTestEnv();
    expect(await env.appointments.reserveNextSequence(TEST_DATE, 'F')).toBe(1);
    expect(await env.appointments.reserveNextSequence(TEST_DATE, 'F')).toBe(2);
    expect(await env.appointments.reserveNextSequence(TEST_DATE, 'J')).toBe(1);
  });

  it('listByDate ordina per orario e nasconde le annullate salvo richiesta esplicita', async () => {
    const env = buildTestEnv();
    const late = makeAppointment({ scheduledAt: '2026-09-10T09:00:00.000Z' as never });
    const early = makeAppointment({ scheduledAt: '2026-09-10T06:00:00.000Z' as never });
    const cancelled = makeAppointment({ status: 'CANCELLED' });
    for (const a of [late, early, cancelled]) {
      await env.appointments.insert(a);
    }
    const visible = await env.appointments.listByDate(TEST_DATE);
    expect(visible.map((a) => a.id)).toEqual([early.id, late.id]);

    const onlyCancelled = await env.appointments.listByDate(TEST_DATE, { statuses: ['CANCELLED'] });
    expect(onlyCancelled.map((a) => a.id)).toEqual([cancelled.id]);

    const otherDesk = await env.appointments.listByDate(TEST_DATE, {
      deskIds: [asDeskId('desk-s2')],
    });
    expect(otherDesk).toHaveLength(0);
  });
});
