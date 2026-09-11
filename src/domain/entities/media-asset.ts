// Metadati di foto/video del fascicolo della pratica (P5).
// Il binario vive dietro IMediaStorage (memoria nello scaffold, disco locale in M5).

import type { AppointmentId, MediaAssetId, OperatorId } from '../ids';
import type { IsoDateTime } from '../value-objects/iso-date';

/** Tipo di media acquisito dal tablet. */
export type MediaKind = 'PHOTO' | 'VIDEO';

/**
 * Parte del veicolo ripresa. Il giro dell'auto ha un ordine fisso e le quattro fiancate sono
 * obbligatorie: al ritiro, se il cliente contesta un graffio, serve sapere che a quel punto del
 * giro quella parte era stata fotografata — non "c'erano delle foto".
 */
export type MediaCategory = 'FRONT' | 'REAR' | 'LEFT' | 'RIGHT' | 'INTERIOR' | 'DAMAGE';

/** Le quattro riprese senza le quali il check-in non si chiude. */
export const REQUIRED_PHOTO_CATEGORIES = [
  'FRONT',
  'REAR',
  'LEFT',
  'RIGHT',
] as const satisfies readonly MediaCategory[];

/** Tutte le categorie, nell'ordine in cui compaiono al tablet. */
export const PHOTO_CATEGORIES = [
  'FRONT',
  'REAR',
  'LEFT',
  'RIGHT',
  'INTERIOR',
  'DAMAGE',
] as const satisfies readonly MediaCategory[];

/** Etichette in italiano, usate al tablet e nel fascicolo. */
export const PHOTO_CATEGORY_LABELS: Readonly<Record<MediaCategory, string>> = {
  FRONT: 'Frontale',
  REAR: 'Posteriore',
  LEFT: 'Fiancata sinistra',
  RIGHT: 'Fiancata destra',
  INTERIOR: 'Interni',
  DAMAGE: 'Dettaglio danni',
};

/** True se la categoria è fra quelle obbligatorie. */
export function isRequiredCategory(category: MediaCategory): boolean {
  return (REQUIRED_PHOTO_CATEGORIES as readonly MediaCategory[]).includes(category);
}

/** Type guard per i valori che arrivano dal client. */
export function isMediaCategory(value: unknown): value is MediaCategory {
  return typeof value === 'string' && (PHOTO_CATEGORIES as readonly string[]).includes(value);
}

/** Metadati di un media associato alla pratica. */
export interface MediaAsset {
  readonly id: MediaAssetId;
  readonly appointmentId: AppointmentId;
  readonly kind: MediaKind;
  /** Parte del veicolo ripresa (le foto acquisite prima di M5 non ce l'hanno: `null`). */
  readonly category: MediaCategory | null;
  readonly mimeType: string;
  readonly sizeBytes: number;
  /** Chiave nello storage (IMediaStorage). */
  readonly storageKey: string;
  readonly thumbnailKey: string | null;
  readonly capturedByOperatorId: OperatorId;
  readonly capturedAt: IsoDateTime;
  readonly note: string | null;
}
