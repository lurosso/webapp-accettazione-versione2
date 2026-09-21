// L'archivio porta con sé lo stato di conservazione di ogni pratica: è lì che l'amministratore
// cerca la targa di tre mesi fa quando arriva una contestazione, e il vincolo legale si mette da lì.
// Il PATCH lavora per id e il repository cerca su tutte le giornate: una pratica passata si tratta
// come una di oggi.
import { describe, expect, it } from 'vitest';
import { AssistanceService } from '@/application/admin/AssistanceService';
import { InspectionArchiveService } from '@/application/media/InspectionArchiveService';
import { InspectionService } from '@/application/media/InspectionService';
import { QueueService } from '@/application/queue/QueueService';
import type { Appointment } from '@/domain/entities/appointment';
import { asOperatorId } from '@/domain/ids';
import type { IsoDate } from '@/domain/value-objects/iso-date';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import { buildTestEnv, makeAppointment, TestClock } from '../helpers/fixtures';

function setup() {
  const clock = new TestClock();
  const env = buildTestEnv(clock);
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
  const inspection = new InspectionService({
    appointments: env.appointments,
    media: env.media,
    mediaStorage: env.mediaStorage,
    queueService,
    crmNotifier: env.crmNotifier,
    clock,
    ids: env.ids,
    logger: env.logger,
    retentionDays: 90,
  });
  const archive = new InspectionArchiveService({
    appointments: env.appointments,
    media: env.media,
    mediaStorage: env.mediaStorage,
    referenceData: env.referenceData,
    clock,
    logger: env.logger,
    hardDeleteDays: 90,
  });
  const assistance = new AssistanceService({
    appointments: env.appointments,
    referenceData: env.referenceData,
    operators: env.operators,
    claims: env.workstationClaims,
    clock,
  });
  return { env, clock, inspection, archive, assistance };
}

async function conFoto(s: ReturnType<typeof setup>, a: Appointment): Promise<Appointment> {
  const r = await s.env.appointments.insert(a);
  if (!r.ok) {
    throw new Error(r.error.message);
  }
  const foto = await s.inspection.addPhoto({
    appointmentId: r.value.id,
    operatorId: asOperatorId('op-advisor-1'),
    bytes: new Uint8Array(256).fill(1),
    mimeType: 'image/jpeg',
    category: 'FRONT',
  });
  if (!foto.ok) {
    throw new Error(foto.error.message);
  }
  return r.value;
}

describe('archivio ispezioni: la conservazione viaggia con la scheda', () => {
  it('ogni voce dice se la commessa è chiusa e se c’è un vincolo legale', async () => {
    const s = setup();
    const aperta = await conFoto(s, makeAppointment({ status: 'COMPLETED' }));
    const vincolata = await conFoto(
      s,
      makeAppointment({
        status: 'COMPLETED',
        orderClosedAt: '2026-09-01T10:00:00.000Z' as IsoDateTime,
        legalHoldAt: '2026-09-02T10:00:00.000Z' as IsoDateTime,
        legalHoldReason: 'Contestazione paraurti',
      }),
    );

    const [vAperta] = await s.archive.search(aperta.code);
    expect(vAperta).toMatchObject({ orderClosedAt: null, legalHoldAt: null, legalHoldReason: null });

    const [vVincolata] = await s.archive.search(vincolata.code);
    expect(vVincolata).toMatchObject({
      orderClosedAt: '2026-09-01T10:00:00.000Z',
      legalHoldAt: '2026-09-02T10:00:00.000Z',
      legalHoldReason: 'Contestazione paraurti',
    });
  });

  it('il vincolo si mette anche su una pratica di mesi fa, e l’archivio lo mostra subito', async () => {
    const s = setup();
    // Una pratica di tre mesi prima: non è nell'agenda di oggi, ma è in archivio.
    const vecchia = await conFoto(
      s,
      makeAppointment({
        status: 'COMPLETED',
        businessDate: '2026-06-10' as IsoDate,
        scheduledAt: '2026-06-10T08:00:00.000Z' as IsoDateTime,
      }),
    );

    const esito = await s.assistance.setRetention(vecchia.id, {
      legalHold: { active: true, reason: 'Richiesta assicurazione' },
    });
    expect(esito.ok).toBe(true);

    const [voce] = await s.archive.search(vecchia.code);
    expect(voce?.legalHoldAt).toBe(s.clock.nowIso());
    expect(voce?.legalHoldReason).toBe('Richiesta assicurazione');
    expect(voce?.businessDate).toBe('2026-06-10');
  });
});
