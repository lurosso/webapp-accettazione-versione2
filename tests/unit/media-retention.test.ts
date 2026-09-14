import { describe, expect, it } from 'vitest';
import { InspectionArchiveService } from '@/application/media/InspectionArchiveService';
import { InspectionService } from '@/application/media/InspectionService';
import { QueueService, type ActionContext } from '@/application/queue/QueueService';
import type { Appointment } from '@/domain/entities/appointment';
import type { PlateNumber } from '@/domain/value-objects/plate';
import { asOperatorId, asWorkstationId } from '@/domain/ids';
import { buildTestEnv, makeAppointment, TestClock } from '../helpers/fixtures';

const RETENTION_DAYS = 30;
const GIORNO_MS = 24 * 60 * 60_000;

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
    retentionDays: RETENTION_DAYS,
  });
  const archive = new InspectionArchiveService({
    appointments: env.appointments,
    media: env.media,
    mediaStorage: env.mediaStorage,
    referenceData: env.referenceData,
    clock,
    logger: env.logger,
  });
  const ctx: ActionContext = {
    operatorId: asOperatorId('op-advisor-1'),
    workstationId: asWorkstationId('ws-p1'),
    correlationId: 'corr-retention',
  };
  return { env, clock, inspection, archive, ctx };
}

async function insert(env: ReturnType<typeof buildTestEnv>, a: Appointment): Promise<Appointment> {
  const r = await env.appointments.insert(a);
  if (!r.ok) {
    throw new Error(r.error.message);
  }
  return r.value;
}

const foto = () => new Uint8Array(512).fill(1);

describe('Foto: metadati e scadenza', () => {
  it('ogni foto nasce con pratica, categoria, percorso, istante e scadenza di retention', async () => {
    const { env, clock, inspection, ctx } = setup();
    const a = await insert(env, makeAppointment());

    const r = await inspection.addPhoto({
      appointmentId: a.id,
      operatorId: ctx.operatorId,
      bytes: foto(),
      mimeType: 'image/jpeg',
      category: 'FRONT',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    const asset = r.value.asset;
    expect(asset.appointmentId).toBe(a.id);
    expect(asset.category).toBe('FRONT');
    expect(asset.storageKey).toContain(a.code);
    expect(asset.capturedAt).toBe(clock.nowIso());
    expect(asset.archivedAt).toBeNull();
    const scadenzaAttesa = new Date(
      clock.now().getTime() + RETENTION_DAYS * GIORNO_MS,
    ).toISOString();
    expect(asset.expiresAt).toBe(scadenzaAttesa);
  });
});

describe('InspectionArchiveService: retention', () => {
  it('prima della scadenza non tocca nulla', async () => {
    const { env, clock, inspection, archive, ctx } = setup();
    const a = await insert(env, makeAppointment());
    await inspection.addPhoto({
      appointmentId: a.id,
      operatorId: ctx.operatorId,
      bytes: foto(),
      mimeType: 'image/jpeg',
      category: 'REAR',
    });

    clock.advance((RETENTION_DAYS - 1) * GIORNO_MS);
    expect(await archive.purgeExpired()).toEqual({ examined: 0, archived: 0, failed: 0 });
    expect(env.mediaStorage.size).toBe(1);
  });

  it('dopo la scadenza elimina il file e marca il record come archiviato, senza cancellarlo', async () => {
    const { env, clock, inspection, archive, ctx } = setup();
    const a = await insert(env, makeAppointment());
    const salvata = await inspection.addPhoto({
      appointmentId: a.id,
      operatorId: ctx.operatorId,
      bytes: foto(),
      mimeType: 'image/jpeg',
      category: 'LEFT',
    });
    const key = salvata.ok ? salvata.value.asset.storageKey : '';

    clock.advance((RETENTION_DAYS + 1) * GIORNO_MS);
    const esito = await archive.purgeExpired();
    expect(esito).toEqual({ examined: 1, archived: 1, failed: 0 });

    // Il file non c'è più, il record sì: dice ancora che il giro era stato fatto.
    expect(env.mediaStorage.get(key)).toBeNull();
    const record = (await env.media.listByAppointment(a.id))[0];
    expect(record?.archivedAt).toBe(clock.nowIso());
    expect(record?.category).toBe('LEFT');

    // Una seconda passata non trova più nulla da fare.
    expect(await archive.purgeExpired()).toEqual({ examined: 0, archived: 0, failed: 0 });
  });

  it('un file già sparito dal disco conta come archiviato, non come errore', async () => {
    const { env, clock, inspection, archive, ctx } = setup();
    const a = await insert(env, makeAppointment());
    const salvata = await inspection.addPhoto({
      appointmentId: a.id,
      operatorId: ctx.operatorId,
      bytes: foto(),
      mimeType: 'image/jpeg',
      category: 'RIGHT',
    });
    if (salvata.ok) {
      await env.mediaStorage.delete(salvata.value.asset.storageKey);
    }
    clock.advance((RETENTION_DAYS + 1) * GIORNO_MS);
    expect(await archive.purgeExpired()).toEqual({ examined: 1, archived: 1, failed: 0 });
  });
});

describe('InspectionArchiveService: ricerca', () => {
  it('trova i check-in per targa (anche scritta con spazi e minuscole) e per codice', async () => {
    const { env, inspection, archive, ctx } = setup();
    const a = await insert(env, makeAppointment({ notes: 'Graffio sul paraurti' }));
    const altra = await insert(env, makeAppointment());
    for (const pratica of [a, altra]) {
      await inspection.addPhoto({
        appointmentId: pratica.id,
        operatorId: ctx.operatorId,
        bytes: foto(),
        mimeType: 'image/jpeg',
        category: 'FRONT',
      });
    }

    const targa = a.vehicle.plate as PlateNumber;
    const perTarga = await archive.search(` ${targa.slice(0, 2).toLowerCase()} ${targa.slice(2)} `);
    expect(perTarga.map((e) => e.code)).toEqual([a.code]);
    expect(perTarga[0]?.notes).toBe('Graffio sul paraurti');
    expect(perTarga[0]?.photos[0]?.categoryLabel).toBe('Frontale');
    expect(perTarga[0]?.photos[0]?.url).toContain('/api/v1/media/');

    const perCodice = await archive.search(altra.code.toLowerCase());
    expect(perCodice.map((e) => e.code)).toEqual([altra.code]);

    const tutti = await archive.search('');
    expect(tutti).toHaveLength(2);
    expect(await archive.search('ZZ999ZZ')).toHaveLength(0);
  });

  it('le foto archiviate compaiono senza indirizzo e la scheda risulta archiviata', async () => {
    const { env, clock, inspection, archive, ctx } = setup();
    const a = await insert(env, makeAppointment());
    await inspection.addPhoto({
      appointmentId: a.id,
      operatorId: ctx.operatorId,
      bytes: foto(),
      mimeType: 'image/jpeg',
      category: 'FRONT',
    });
    clock.advance((RETENTION_DAYS + 1) * GIORNO_MS);
    await archive.purgeExpired();

    const [voce] = await archive.search(a.code);
    expect(voce?.archived).toBe(true);
    expect(voce?.photos[0]?.url).toBeNull();
    expect(voce?.photos[0]?.archivedAt).toBe(clock.nowIso());
  });
});
