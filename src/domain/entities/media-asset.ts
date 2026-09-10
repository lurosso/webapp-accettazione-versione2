// Metadati di foto/video del fascicolo della pratica (P5).
// Il binario vive dietro IMediaStorage (memoria nello scaffold, disco locale in M5).

import type { AppointmentId, MediaAssetId, OperatorId } from '../ids';
import type { IsoDateTime } from '../value-objects/iso-date';

/** Tipo di media acquisito dal tablet. */
export type MediaKind = 'PHOTO' | 'VIDEO';

/** Metadati di un media associato alla pratica. */
export interface MediaAsset {
  readonly id: MediaAssetId;
  readonly appointmentId: AppointmentId;
  readonly kind: MediaKind;
  readonly mimeType: string;
  readonly sizeBytes: number;
  /** Chiave nello storage (IMediaStorage). */
  readonly storageKey: string;
  readonly thumbnailKey: string | null;
  readonly capturedByOperatorId: OperatorId;
  readonly capturedAt: IsoDateTime;
  readonly note: string | null;
}
