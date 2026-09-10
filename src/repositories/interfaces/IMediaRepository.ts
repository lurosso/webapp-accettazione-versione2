// Metadati dei media del fascicolo (P5).

import type { MediaAsset } from '@/domain/entities/media-asset';
import type { AppointmentId, MediaAssetId } from '@/domain/ids';

/** Repository dei metadati media. */
export interface IMediaRepository {
  insert(asset: MediaAsset): Promise<MediaAsset>;
  listByAppointment(appointmentId: AppointmentId): Promise<readonly MediaAsset[]>;
  delete(id: MediaAssetId): Promise<void>;
}
