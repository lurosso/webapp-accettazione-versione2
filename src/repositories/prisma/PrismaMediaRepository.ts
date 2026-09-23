// Metadati di foto e video su SQLite. I byte stanno su disco (`MediaStorageLocalDisk`), qui c'è
// quello che serve a ritrovarli, a mostrarli e a decidere quando eliminarli: pratica, tipo,
// chiave del file, scadenza, archiviazione. È il pezzo che prima viveva in memoria: al riavvio i
// file c'erano ancora e le schede no.
import type { MediaAsset } from '@/domain/entities/media-asset';
import type { AppointmentId, MediaAssetId } from '@/domain/ids';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import type { MediaAsset as Row } from '@/generated/prisma/client';
import type { IMediaRepository } from '../interfaces/IMediaRepository';
import type { Db } from './client';

function toEntity(r: Row): MediaAsset {
  return {
    id: r.id as MediaAsset['id'],
    appointmentId: r.appointmentId as MediaAsset['appointmentId'],
    kind: r.kind as MediaAsset['kind'],
    category: r.category as MediaAsset['category'],
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    storageKey: r.storageKey,
    thumbnailKey: r.thumbnailKey,
    capturedByOperatorId: r.capturedByOperatorId as MediaAsset['capturedByOperatorId'],
    capturedAt: r.capturedAt as IsoDateTime,
    note: r.note,
    clientUploadId: r.clientUploadId,
    expiresAt: r.expiresAt as IsoDateTime,
    archivedAt: r.archivedAt as MediaAsset['archivedAt'],
  };
}

function toRow(m: MediaAsset): Row {
  return {
    id: m.id,
    appointmentId: m.appointmentId,
    kind: m.kind,
    category: m.category,
    mimeType: m.mimeType,
    sizeBytes: m.sizeBytes,
    storageKey: m.storageKey,
    thumbnailKey: m.thumbnailKey,
    capturedByOperatorId: m.capturedByOperatorId,
    capturedAt: m.capturedAt,
    note: m.note,
    clientUploadId: m.clientUploadId,
    expiresAt: m.expiresAt,
    archivedAt: m.archivedAt,
  };
}

export class PrismaMediaRepository implements IMediaRepository {
  constructor(private readonly db: Db) {}

  async insert(asset: MediaAsset): Promise<MediaAsset> {
    return toEntity(await this.db.mediaAsset.create({ data: toRow(asset) }));
  }

  async findByClientUploadId(
    appointmentId: AppointmentId,
    clientUploadId: string,
  ): Promise<MediaAsset | null> {
    const r = await this.db.mediaAsset.findFirst({ where: { appointmentId, clientUploadId } });
    return r === null ? null : toEntity(r);
  }

  async listByAppointment(appointmentId: AppointmentId): Promise<readonly MediaAsset[]> {
    const rows = await this.db.mediaAsset.findMany({
      where: { appointmentId },
      orderBy: { capturedAt: 'asc' },
    });
    return rows.map(toEntity);
  }

  async listAll(): Promise<readonly MediaAsset[]> {
    return (await this.db.mediaAsset.findMany()).map(toEntity);
  }

  async listExpired(now: IsoDateTime): Promise<readonly MediaAsset[]> {
    const rows = await this.db.mediaAsset.findMany({
      where: { archivedAt: null, expiresAt: { lte: now } },
    });
    return rows.map(toEntity);
  }

  async listArchivedBefore(cutoff: IsoDateTime): Promise<readonly MediaAsset[]> {
    const rows = await this.db.mediaAsset.findMany({
      where: { archivedAt: { not: null, lte: cutoff } },
    });
    return rows.map(toEntity);
  }

  /** Upsert per id, come la memoria: aggiornare un record che non c'è lo crea. */
  async update(asset: MediaAsset): Promise<MediaAsset> {
    const riga = toRow(asset);
    const { id: _id, ...dati } = riga;
    return toEntity(
      await this.db.mediaAsset.upsert({ where: { id: asset.id }, create: riga, update: dati }),
    );
  }

  async delete(id: MediaAssetId): Promise<void> {
    await this.db.mediaAsset.deleteMany({ where: { id } });
  }
}
