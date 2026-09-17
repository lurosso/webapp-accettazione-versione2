import { describe, expect, it } from 'vitest';
import {
  InspectionService,
  MAX_PHOTO_BYTES,
  MAX_VIDEO_BYTES,
} from '@/application/media/InspectionService';
import { QueueService, type ActionContext } from '@/application/queue/QueueService';
import { asOperatorId, asWorkstationId } from '@/domain/ids';
import { buildTestEnv, makeAppointment } from '../helpers/fixtures';

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
    correlationId: 'corr-tablet',
  };
  return { env, queueService, inspection, ctx };
}

const bytes = (n: number): Uint8Array => new Uint8Array(n).fill(3);

describe('Check-in: video obbligatorio e foto facoltative', () => {
  it('accetta un video mp4 come media VIDEO senza categoria, con il limite dedicato', async () => {
    const { env, inspection, ctx } = setup();
    const a = await env.appointments.insert(makeAppointment());
    if (!a.ok) {
      throw new Error('insert');
    }
    const video = await inspection.addMedia({
      appointmentId: a.value.id,
      operatorId: ctx.operatorId,
      bytes: bytes(5 * 1024 * 1024),
      mimeType: 'video/mp4',
      category: null,
    });
    expect(video.ok).toBe(true);
    if (video.ok) {
      expect(video.value.asset.kind).toBe('VIDEO');
      expect(video.value.asset.category).toBeNull();
      expect(video.value.asset.storageKey).toMatch(/\.mp4$/);
      expect(video.value.url.length).toBeGreaterThan(0);
    }
    // Un video più grande di una foto passa (limite video), oltre il limite video no.
    const grande = await inspection.addMedia({
      appointmentId: a.value.id,
      operatorId: ctx.operatorId,
      bytes: bytes(MAX_PHOTO_BYTES + 1024),
      mimeType: 'video/quicktime',
      category: null,
    });
    expect(grande.ok).toBe(true);
    const enorme = await inspection.addMedia({
      appointmentId: a.value.id,
      operatorId: ctx.operatorId,
      bytes: bytes(MAX_VIDEO_BYTES + 1),
      mimeType: 'video/mp4',
      category: null,
    });
    expect(!enorme.ok && enorme.error.code === 'VALIDATION').toBe(true);
    // Un formato che non è né immagine né video viene rifiutato.
    const pdf = await inspection.addMedia({
      appointmentId: a.value.id,
      operatorId: ctx.operatorId,
      bytes: bytes(100),
      mimeType: 'application/pdf',
      category: null,
    });
    expect(!pdf.ok && pdf.error.code === 'VALIDATION').toBe(true);
    // Una foto senza casella finisce fra le aggiuntive (EXTRA).
    const extra = await inspection.addMedia({
      appointmentId: a.value.id,
      operatorId: ctx.operatorId,
      bytes: bytes(2048),
      mimeType: 'image/jpeg',
      category: null,
    });
    expect(
      extra.ok && extra.value.asset.kind === 'PHOTO' && extra.value.asset.category === 'EXTRA',
    ).toBe(true);
  });

  it('il check-in vuole il video ma non le foto, e conta i due tipi separatamente', async () => {
    const { env, queueService, inspection, ctx } = setup();
    const inserita = await env.appointments.insert(makeAppointment());
    if (!inserita.ok) {
      throw new Error('insert');
    }
    const a = inserita.value;
    await queueService.takeInCharge({ appointmentId: a.id, expectedVersion: 1, bayId: null }, ctx);

    // Senza alcun media la chiusura è rifiutata: manca la ripresa del veicolo.
    const senzaNulla = await inspection.completeCheckIn(
      { appointmentId: a.id, expectedVersion: 2, inspectionNotes: 'Nessun danno visibile' },
      ctx,
    );
    expect(!senzaNulla.ok && senzaNulla.error.code === 'VALIDATION').toBe(true);

    // Una foto non basta: il requisito è il video.
    await inspection.addMedia({
      appointmentId: a.id,
      operatorId: ctx.operatorId,
      bytes: bytes(2048),
      mimeType: 'image/jpeg',
      category: 'EXTRA',
    });
    const soloFoto = await inspection.completeCheckIn(
      { appointmentId: a.id, expectedVersion: 2, inspectionNotes: 'Nessun danno visibile' },
      ctx,
    );
    expect(!soloFoto.ok && soloFoto.error.code === 'VALIDATION').toBe(true);
    expect(env.crm.received).toHaveLength(0);

    // Con il video la pratica si chiude, senza nessuna delle quattro riprese consigliate.
    await inspection.addMedia({
      appointmentId: a.id,
      operatorId: ctx.operatorId,
      bytes: bytes(4096),
      mimeType: 'video/webm',
      category: null,
    });
    expect(await inspection.missingSuggestedCategories(a.id)).toEqual([
      'FRONT',
      'REAR',
      'LEFT',
      'RIGHT',
    ]);
    const conVideo = await inspection.completeCheckIn(
      { appointmentId: a.id, expectedVersion: 2, inspectionNotes: 'Nessun danno visibile' },
      ctx,
    );
    expect(conVideo.ok).toBe(true);
    if (conVideo.ok) {
      expect(conVideo.value.appointment.status).toBe('COMPLETED');
      expect(conVideo.value.photoCount).toBe(1);
      expect(conVideo.value.videoCount).toBe(1);
      expect(conVideo.value.appointment.notes).toContain('Nessun danno visibile');
    }
    // Il CRM riceve foto e video insieme.
    const ricevuto = env.crm.received.at(-1) as { readonly photos: readonly unknown[] };
    expect(ricevuto.photos).toHaveLength(2);
  });
});
