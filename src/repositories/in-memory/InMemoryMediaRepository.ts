// Metadati media in memoria (P5).

import type { MediaAsset } from '@/domain/entities/media-asset';
import type { AppointmentId, MediaAssetId } from '@/domain/ids';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import type { IMediaRepository } from '../interfaces/IMediaRepository';
import type { InMemoryStore } from './InMemoryStore';

/** Metadati media in memoria. */
export class InMemoryMediaRepository implements IMediaRepository {
  constructor(private readonly store: InMemoryStore) {}

  async insert(asset: MediaAsset): Promise<MediaAsset> {
    // Come l'indice unico del database: lo stesso caricamento del tablet non entra due volte.
    if (
      asset.clientUploadId !== null &&
      [...this.store.state.media.values()].some(
        (m) => m.appointmentId === asset.appointmentId && m.clientUploadId === asset.clientUploadId,
      )
    ) {
      throw new Error(`clientUploadId già presente per la pratica: ${asset.clientUploadId}`);
    }
    const stored = { ...asset };
    this.store.state.media.set(stored.id, stored);
    return { ...stored };
  }

  async listByAppointment(appointmentId: AppointmentId): Promise<readonly MediaAsset[]> {
    return [...this.store.state.media.values()]
      .filter((m) => m.appointmentId === appointmentId)
      .sort((a, b) => (a.capturedAt < b.capturedAt ? -1 : a.capturedAt > b.capturedAt ? 1 : 0))
      .map((m) => ({ ...m }));
  }

  async findByClientUploadId(
    appointmentId: AppointmentId,
    clientUploadId: string,
  ): Promise<MediaAsset | null> {
    const trovato = [...this.store.state.media.values()].find(
      (m) => m.appointmentId === appointmentId && m.clientUploadId === clientUploadId,
    );
    return trovato === undefined ? null : { ...trovato };
  }

  async listAll(): Promise<readonly MediaAsset[]> {
    return [...this.store.state.media.values()].map((m) => ({ ...m }));
  }

  async listExpired(now: IsoDateTime): Promise<readonly MediaAsset[]> {
    return [...this.store.state.media.values()]
      .filter((m) => m.archivedAt === null && m.expiresAt <= now)
      .map((m) => ({ ...m }));
  }

  async listArchivedBefore(cutoff: IsoDateTime): Promise<readonly MediaAsset[]> {
    return [...this.store.state.media.values()]
      .filter((m) => m.archivedAt !== null && m.archivedAt <= cutoff)
      .map((m) => ({ ...m }));
  }

  async update(asset: MediaAsset): Promise<MediaAsset> {
    const stored = { ...asset };
    this.store.state.media.set(stored.id, stored);
    return { ...stored };
  }

  async delete(id: MediaAssetId): Promise<void> {
    this.store.state.media.delete(id);
  }
}
