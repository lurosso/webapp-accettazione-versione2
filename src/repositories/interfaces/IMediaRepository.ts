// Metadati dei media del fascicolo (P5).

import type { MediaAsset } from '@/domain/entities/media-asset';
import type { AppointmentId, MediaAssetId } from '@/domain/ids';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';

/** Repository dei metadati media. */
export interface IMediaRepository {
  insert(asset: MediaAsset): Promise<MediaAsset>;
  listByAppointment(appointmentId: AppointmentId): Promise<readonly MediaAsset[]>;
  /** Tutti i metadati (archivio ispezioni); l'ordine non è garantito. */
  listAll(): Promise<readonly MediaAsset[]>;
  /** Foto con `expiresAt <= now` e file ancora presente (`archivedAt === null`). */
  listExpired(now: IsoDateTime): Promise<readonly MediaAsset[]>;
  update(asset: MediaAsset): Promise<MediaAsset>;
  delete(id: MediaAssetId): Promise<void>;
}
