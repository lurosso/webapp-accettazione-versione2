// Metadati media in memoria (P5).

import type { MediaAsset } from '@/domain/entities/media-asset';
import type { AppointmentId, MediaAssetId } from '@/domain/ids';
import type { IMediaRepository } from '../interfaces/IMediaRepository';
import type { InMemoryStore } from './InMemoryStore';

/** Metadati media in memoria. */
export class InMemoryMediaRepository implements IMediaRepository {
  constructor(private readonly store: InMemoryStore) {}

  async insert(asset: MediaAsset): Promise<MediaAsset> {
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

  async delete(id: MediaAssetId): Promise<void> {
    this.store.state.media.delete(id);
  }
}
