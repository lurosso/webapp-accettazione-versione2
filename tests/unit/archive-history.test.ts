import { describe, expect, it } from 'vitest';
import { InspectionArchiveService } from '@/application/media/InspectionArchiveService';
import { asAppointmentId, asMediaAssetId, asOperatorId } from '@/domain/ids';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import type { PlateNumber } from '@/domain/value-objects/plate';
import { MediaStorageMock } from '@/services/mocks/MediaStorageMock';
import { buildTestEnv, makeAppointment } from '../helpers/fixtures';

function setup() {
  const env = buildTestEnv();
  const service = new InspectionArchiveService({
    appointments: env.appointments,
    media: env.media,
    mediaStorage: new MediaStorageMock({ latencyMs: 0 }, { logger: env.logger }),
    referenceData: env.referenceData,
    clock: env.clock,
    logger: env.logger,
    hardDeleteDays: 90,
  });
  return { env, service };
}

describe('Archivio: storico per targa', () => {
  it('la ricerca per targa elenca ogni ingresso storico del veicolo, con data, stato e commessa, anche senza foto', async () => {
    const { env, service } = setup();
    const targa = 'FM393TR' as PlateNumber;
    const ingressi = [
      { businessDate: '2026-09-01', status: 'COMPLETED', workOrderRef: 'LO01 265001/2026' },
      { businessDate: '2026-09-10', status: 'COMPLETED', workOrderRef: 'LO01 266020/2026' },
      { businessDate: '2026-09-16', status: 'WAITING', workOrderRef: null },
    ] as const;
    for (const i of ingressi) {
      const base = makeAppointment({
        businessDate: i.businessDate as never,
        status: i.status,
        workOrderRef: i.workOrderRef,
        completedAt: i.status === 'COMPLETED' ? ('2026-09-10T15:00:00.000Z' as IsoDateTime) : null,
      });
      await env.appointments.insert({ ...base, vehicle: { ...base.vehicle, plate: targa } });
    }
    // Una foto solo sul secondo ingresso: gli altri devono comparire lo stesso.
    const conFoto = (await env.appointments.searchHistory({ plate: 'FM393TR' }, 10)).find(
      (a) => a.businessDate === '2026-09-10',
    )!;
    await env.media.insert({
      id: asMediaAssetId('foto-1'),
      appointmentId: conFoto.id,
      kind: 'PHOTO',
      category: 'FRONT',
      mimeType: 'image/jpeg',
      sizeBytes: 1200,
      storageKey: 'foto-1.jpg',
      thumbnailKey: null,
      capturedByOperatorId: asOperatorId('op-advisor-1'),
      capturedAt: '2026-09-10T08:10:00.000Z' as IsoDateTime,
      note: null,
      clientUploadId: null,
      expiresAt: '2026-10-10T08:10:00.000Z' as IsoDateTime,
      archivedAt: null,
    });

    const storia = await service.search('fm 393 tr');
    expect(storia.map((e) => e.businessDate)).toEqual(['2026-09-16', '2026-09-10', '2026-09-01']);
    expect(storia.map((e) => e.photos.length)).toEqual([0, 1, 0]);
    expect(storia[1]?.workOrderRef).toBe('LO01 266020/2026');
    expect(storia[0]?.status).toBe('WAITING');
    expect(storia[0]?.flow).toBe('INTAKE');
    expect(storia.every((e) => e.plate === targa)).toBe(true);

    // Senza ricerca restano gli ultimi check-in fotografici: solo l'ingresso con la foto.
    const ultimi = await service.search('');
    expect(ultimi.map((e) => e.businessDate)).toEqual(['2026-09-10']);

    // Anche per codice pratica.
    const perCodice = await service.search(storia[2]!.code);
    expect(perCodice.map((e) => e.appointmentId)).toContain(storia[2]!.appointmentId);
    expect(asAppointmentId(storia[0]!.appointmentId)).toBe(storia[0]!.appointmentId);
  });

  it('la giornata elenca tutte le pratiche del giorno, con o senza foto, in ordine di agenda', async () => {
    const { env, service } = setup();
    const giorno = '2026-09-16' as never;
    const tardi = makeAppointment({
      businessDate: giorno,
      scheduledAt: '2026-09-16T09:30:00.000Z' as IsoDateTime,
    });
    const presto = makeAppointment({
      businessDate: giorno,
      scheduledAt: '2026-09-16T07:00:00.000Z' as IsoDateTime,
    });
    const altroGiorno = makeAppointment({ businessDate: '2026-09-15' as never });
    for (const a of [tardi, presto, altroGiorno]) {
      await env.appointments.insert(a);
    }
    await env.media.insert({
      id: asMediaAssetId('video-1'),
      appointmentId: tardi.id,
      kind: 'VIDEO',
      category: null,
      mimeType: 'video/mp4',
      sizeBytes: 5000,
      storageKey: 'video-1.mp4',
      thumbnailKey: null,
      capturedByOperatorId: asOperatorId('op-advisor-1'),
      capturedAt: '2026-09-16T09:40:00.000Z' as IsoDateTime,
      note: null,
      clientUploadId: null,
      expiresAt: '2026-10-16T09:40:00.000Z' as IsoDateTime,
      archivedAt: null,
    });

    const oggi = await service.listByDay(giorno);
    // Prima chi è atteso prima; la pratica senza foto c'è lo stesso, quella di ieri no.
    expect(oggi.map((e) => e.appointmentId)).toEqual([presto.id, tardi.id]);
    expect(oggi.map((e) => e.photos.length)).toEqual([0, 1]);
    expect(oggi[1]?.photos[0]?.categoryLabel).toBe('Video del veicolo');
    expect(await service.listByDay('2026-09-14' as never)).toEqual([]);
  });
});
