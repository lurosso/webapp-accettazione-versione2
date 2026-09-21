// Sicurezza upload lato servizio: tipo dai byte, check-in aperto, tetti per pratica.
import { describe, expect, it } from 'vitest';
import {
  FASCICOLO_PIENO,
  InspectionService,
  MAX_VIDEOS_PER_APPOINTMENT,
  MEDIA_SOLO_IN_CARICO,
} from '@/application/media/InspectionService';
import { QueueService, type ActionContext } from '@/application/queue/QueueService';
import type { Appointment } from '@/domain/entities/appointment';
import { asOperatorId, asWorkstationId } from '@/domain/ids';
import { buildTestEnv, makeAppointment } from '../helpers/fixtures';
import {
  exeBytes,
  htmlBytes,
  jpegBytes,
  mp4Bytes,
  pngBytes,
  svgBytes,
} from '../helpers/media-bytes';

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
    correlationId: 'corr-sicurezza',
  };
  return { env, inspection, ctx };
}

async function inCarico(
  s: ReturnType<typeof setup>,
  overrides: Partial<Appointment> = {},
): Promise<Appointment> {
  const r = await s.env.appointments.insert(
    makeAppointment({ status: 'IN_PROGRESS', operatorId: s.ctx.operatorId, ...overrides }),
  );
  if (!r.ok) {
    throw new Error(r.error.message);
  }
  return r.value;
}

describe('Sicurezza upload: il servizio guarda dentro il file', () => {
  it('un eseguibile rinominato .jpg con Content-Type image/jpeg viene rifiutato e non tocca lo storage', async () => {
    const s = setup();
    const a = await inCarico(s);
    const r = await s.inspection.addMedia({
      appointmentId: a.id,
      operatorId: s.ctx.operatorId,
      bytes: exeBytes(),
      mimeType: 'image/jpeg',
      category: 'FRONT',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('VALIDATION');
      expect(r.error.message).toContain('Formato non supportato');
      expect(r.error.details?.['dichiarato']).toBe('image/jpeg');
    }
    expect(s.env.mediaStorage.size).toBe(0);
    expect(await s.env.media.listByAppointment(a.id)).toHaveLength(0);
  });

  it('SVG e HTML sono rifiutati qualunque sia il tipo dichiarato', async () => {
    const s = setup();
    const a = await inCarico(s);
    for (const [bytes, mimeType] of [
      [svgBytes(), 'image/svg+xml'],
      [svgBytes(), 'image/png'],
      [htmlBytes(), 'image/jpeg'],
      [htmlBytes(), 'video/mp4'],
    ] as const) {
      const r = await s.inspection.addMedia({
        appointmentId: a.id,
        operatorId: s.ctx.operatorId,
        bytes,
        mimeType,
        category: null,
      });
      expect(r.ok).toBe(false);
    }
    expect(s.env.mediaStorage.size).toBe(0);
  });

  it('il tipo salvato è quello del contenuto: un PNG dichiarato JPEG resta PNG, anche nella chiave', async () => {
    const s = setup();
    const a = await inCarico(s);
    const r = await s.inspection.addMedia({
      appointmentId: a.id,
      operatorId: s.ctx.operatorId,
      bytes: pngBytes(),
      mimeType: 'image/jpeg',
      category: 'REAR',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.asset.mimeType).toBe('image/png');
      expect(r.value.asset.storageKey).toMatch(/\.png$/);
      expect(r.value.asset.kind).toBe('PHOTO');
    }
  });

  it('senza alcun tipo dichiarato decide comunque il contenuto (un mp4 è un video)', async () => {
    const s = setup();
    const a = await inCarico(s);
    const r = await s.inspection.addMedia({
      appointmentId: a.id,
      operatorId: s.ctx.operatorId,
      bytes: mp4Bytes(),
      mimeType: '',
      category: null,
    });
    expect(r.ok && r.value.asset.kind).toBe('VIDEO');
    expect(r.ok && r.value.asset.mimeType).toBe('video/mp4');
  });
});

describe('Sicurezza upload: integrità del fascicolo', () => {
  it('non si carica su una pratica completata, annullata o ancora in attesa: il check-in non è aperto', async () => {
    const s = setup();
    for (const status of ['COMPLETED', 'CANCELLED', 'WAITING', 'NO_SHOW'] as const) {
      const r0 = await s.env.appointments.insert(makeAppointment({ status }));
      if (!r0.ok) {
        throw new Error(r0.error.message);
      }
      const r = await s.inspection.addMedia({
        appointmentId: r0.value.id,
        operatorId: s.ctx.operatorId,
        bytes: jpegBytes(),
        mimeType: 'image/jpeg',
        category: 'FRONT',
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe('INVALID_TRANSITION');
        expect(r.error.message).toBe(MEDIA_SOLO_IN_CARICO);
      }
    }
    expect(s.env.mediaStorage.size).toBe(0);
  });

  it('oltre il tetto di video per pratica il fascicolo è pieno e lo storage non cresce', async () => {
    const s = setup();
    const a = await inCarico(s);
    for (let i = 0; i < MAX_VIDEOS_PER_APPOINTMENT; i += 1) {
      const r = await s.inspection.addMedia({
        appointmentId: a.id,
        operatorId: s.ctx.operatorId,
        bytes: mp4Bytes(2048),
        mimeType: 'video/mp4',
        category: null,
      });
      expect(r.ok).toBe(true);
    }
    const oltre = await s.inspection.addMedia({
      appointmentId: a.id,
      operatorId: s.ctx.operatorId,
      bytes: mp4Bytes(2048),
      mimeType: 'video/mp4',
      category: null,
    });
    expect(oltre.ok).toBe(false);
    if (!oltre.ok) {
      expect(oltre.error.code).toBe('VALIDATION');
      expect(oltre.error.message).toBe(FASCICOLO_PIENO);
    }
    expect(s.env.mediaStorage.size).toBe(MAX_VIDEOS_PER_APPOINTMENT);
    // Una foto entra ancora: il tetto dei video non chiude il fascicolo alle foto.
    const foto = await s.inspection.addMedia({
      appointmentId: a.id,
      operatorId: s.ctx.operatorId,
      bytes: jpegBytes(),
      mimeType: 'image/jpeg',
      category: 'FRONT',
    });
    expect(foto.ok).toBe(true);
  });
});
