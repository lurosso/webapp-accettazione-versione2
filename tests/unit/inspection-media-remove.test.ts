// Eliminare una foto o un video acquisiti per sbaglio: si può finché il check-in è aperto, poi il
// fascicolo è sigillato. È la documentazione con cui si risponde a una contestazione, quindi la
// finestra in cui l'accettatore la può toccare è solo quella in cui è ancora davanti al veicolo.
import { describe, expect, it } from 'vitest';
import {
  InspectionService,
  MEDIA_SIGILLATI,
  type StoredPhoto,
} from '@/application/media/InspectionService';
import { QueueService, type ActionContext } from '@/application/queue/QueueService';
import type { Appointment } from '@/domain/entities/appointment';
import { asOperatorId, asWorkstationId } from '@/domain/ids';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import { buildTestEnv, makeAppointment } from '../helpers/fixtures';
import { jpegBytes, mp4Bytes } from '../helpers/media-bytes';

function setup() {
  const env = buildTestEnv();
  const queueService = new QueueService({
    appointments: env.appointments,
    referenceData: env.referenceData,
    operators: env.operators,
    notifications: env.notifications,
    crmNotifier: env.crmNotifier,
    eventBus: env.eventBus,
    clock: env.clock,
    ids: env.ids,
    logger: env.logger,
  });
  const inspection = new InspectionService({
    appointments: env.appointments,
    media: env.media,
    mediaStorage: env.mediaStorage,
    queueService,
    crmNotifier: env.crmNotifier,
    clock: env.clock,
    ids: env.ids,
    logger: env.logger,
    retentionDays: 30,
  });
  const ctx: ActionContext = {
    operatorId: asOperatorId('op-advisor-1'),
    workstationId: asWorkstationId('ws-p1'),
    correlationId: 'corr-rimozione',
  };
  return { env, queueService, inspection, ctx };
}

/** Pratica presa in carico, cioè con il check-in aperto. */
async function inCarico(s: ReturnType<typeof setup>, overrides: Partial<Appointment> = {}) {
  const r = await s.env.appointments.insert(makeAppointment(overrides));
  if (!r.ok) {
    throw new Error(r.error.message);
  }
  const presa = await s.queueService.takeInCharge(
    { appointmentId: r.value.id, expectedVersion: r.value.version, bayId: null },
    s.ctx,
  );
  if (!presa.ok) {
    throw new Error(presa.error.message);
  }
  return presa.value;
}

async function scatta(
  s: ReturnType<typeof setup>,
  appointmentId: Appointment['id'],
  mimeType = 'image/jpeg',
): Promise<StoredPhoto> {
  const r = await s.inspection.addMedia({
    appointmentId,
    operatorId: s.ctx.operatorId,
    bytes: mimeType.startsWith('video/') ? mp4Bytes(1024) : jpegBytes(1024),
    mimeType,
    category: mimeType.startsWith('video/') ? null : 'FRONT',
  });
  if (!r.ok) {
    throw new Error(r.error.message);
  }
  return r.value;
}

describe('InspectionService.removeMedia', () => {
  it('durante il check-in elimina file e record, e la foto sparisce dal fascicolo', async () => {
    const s = setup();
    const a = await inCarico(s);
    const foto = await scatta(s, a.id);
    expect(s.env.mediaStorage.get(foto.asset.storageKey)).not.toBeNull();

    const r = await s.inspection.removeMedia({
      appointmentId: a.id,
      mediaId: foto.asset.id,
      operatorId: s.ctx.operatorId,
    });
    expect(r.ok).toBe(true);
    expect(s.env.mediaStorage.get(foto.asset.storageKey)).toBeNull();
    expect(await s.inspection.listPhotos(a.id)).toHaveLength(0);
  });

  it('anche il video si può rifare: eliminato, il check-in torna a non potersi chiudere', async () => {
    const s = setup();
    const a = await inCarico(s);
    const video = await scatta(s, a.id, 'video/mp4');

    const r = await s.inspection.removeMedia({
      appointmentId: a.id,
      mediaId: video.asset.id,
      operatorId: s.ctx.operatorId,
    });
    expect(r.ok).toBe(true);

    const chiusura = await s.inspection.completeCheckIn(
      { appointmentId: a.id, expectedVersion: a.version, inspectionNotes: null },
      s.ctx,
    );
    expect(!chiusura.ok && chiusura.error.details?.['videoMancante']).toBe(true);
  });

  it('concluso il check-in il fascicolo è sigillato: 409 e il file resta', async () => {
    const s = setup();
    const a = await inCarico(s);
    const foto = await scatta(s, a.id);
    await scatta(s, a.id, 'video/mp4');
    const chiusa = await s.inspection.completeCheckIn(
      { appointmentId: a.id, expectedVersion: a.version, inspectionNotes: null },
      s.ctx,
    );
    expect(chiusa.ok).toBe(true);

    const r = await s.inspection.removeMedia({
      appointmentId: a.id,
      mediaId: foto.asset.id,
      operatorId: s.ctx.operatorId,
    });
    expect(!r.ok && r.error.code).toBe('INVALID_TRANSITION');
    expect(!r.ok && r.error.message).toBe(MEDIA_SIGILLATI);
    expect(s.env.mediaStorage.get(foto.asset.storageKey)).not.toBeNull();
    expect(await s.inspection.listPhotos(a.id)).toHaveLength(2);
  });

  it('non si elimina per conto di una pratica quello che appartiene a un altra', async () => {
    const s = setup();
    const a = await inCarico(s);
    const b = await inCarico(s);
    const fotoDiB = await scatta(s, b.id);

    const r = await s.inspection.removeMedia({
      appointmentId: a.id,
      mediaId: fotoDiB.asset.id,
      operatorId: s.ctx.operatorId,
    });
    expect(!r.ok && r.error.code).toBe('NOT_FOUND');
    expect(s.env.mediaStorage.get(fotoDiB.asset.storageKey)).not.toBeNull();
  });

  it('con un vincolo legale non si elimina nemmeno a check-in aperto', async () => {
    const s = setup();
    const a = await inCarico(s, {
      legalHoldAt: '2026-09-10T06:00:00.000Z' as IsoDateTime,
      legalHoldReason: 'Contestazione',
    });
    const foto = await scatta(s, a.id);

    const r = await s.inspection.removeMedia({
      appointmentId: a.id,
      mediaId: foto.asset.id,
      operatorId: s.ctx.operatorId,
    });
    expect(!r.ok && r.error.code).toBe('INVALID_TRANSITION');
    expect(s.env.mediaStorage.get(foto.asset.storageKey)).not.toBeNull();
  });
});
