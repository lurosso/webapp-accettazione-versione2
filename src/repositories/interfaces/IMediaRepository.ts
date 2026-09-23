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
  /** Record già archiviati (file eliminato) con `archivedAt <= cutoff`: candidati all'eliminazione. */
  listArchivedBefore(cutoff: IsoDateTime): Promise<readonly MediaAsset[]>;
  /** Il media caricato con quell'identificativo per la pratica; null se non c'è. */
  findByClientUploadId(
    appointmentId: AppointmentId,
    clientUploadId: string,
  ): Promise<MediaAsset | null>;
  update(asset: MediaAsset): Promise<MediaAsset>;
  delete(id: MediaAssetId): Promise<void>;
}
