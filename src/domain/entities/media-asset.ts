// Metadati di foto/video del fascicolo della pratica (P5).
// Il binario vive dietro IMediaStorage (memoria nello scaffold, disco locale in M5).

import type { AppointmentId, MediaAssetId, OperatorId } from '../ids';
import type { IsoDateTime } from '../value-objects/iso-date';

/** Tipo di media acquisito dal tablet. */
export type MediaKind = 'PHOTO' | 'VIDEO';

/**
 * Parte del veicolo ripresa. Il giro dell'auto ha un ordine fisso, ma NESSUNA ripresa è
 * obbligatoria: davanti al cliente che aspetta, un check-in non si blocca per una foto. Le quattro
 * fiancate restano "consigliate" perché al ritiro, se il cliente contesta un graffio, è quello che
 * serve; `EXTRA` raccoglie gli scatti liberi fatti con il pulsante "+".
 */
export type MediaCategory = 'FRONT' | 'REAR' | 'LEFT' | 'RIGHT' | 'INTERIOR' | 'DAMAGE' | 'EXTRA';

/** Il giro consigliato del veicolo: suggerito al tablet, mai imposto. */
export const SUGGESTED_PHOTO_CATEGORIES = [
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
  'EXTRA',
] as const satisfies readonly MediaCategory[];

/** Etichette in italiano, usate al tablet e nel fascicolo. */
export const PHOTO_CATEGORY_LABELS: Readonly<Record<MediaCategory, string>> = {
  FRONT: 'Frontale',
  REAR: 'Posteriore',
  LEFT: 'Fiancata sinistra',
  RIGHT: 'Fiancata destra',
  INTERIOR: 'Interni',
  DAMAGE: 'Dettaglio danni',
  EXTRA: 'Foto aggiuntiva',
};

/** True se la categoria fa parte del giro consigliato del veicolo. */
export function isSuggestedCategory(category: MediaCategory): boolean {
  return (SUGGESTED_PHOTO_CATEGORIES as readonly MediaCategory[]).includes(category);
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
  /**
   * Parte del veicolo ripresa. È `null` per i video (che riprendono il giro intero) e per le foto
   * acquisite prima di M5.
   */
  readonly category: MediaCategory | null;
  readonly mimeType: string;
  readonly sizeBytes: number;
  /** Chiave nello storage (IMediaStorage). */
  readonly storageKey: string;
  readonly thumbnailKey: string | null;
  readonly capturedByOperatorId: OperatorId;
  readonly capturedAt: IsoDateTime;
  readonly note: string | null;
  /**
   * Identificativo scelto dal tablet per questo caricamento. Rende idempotente il nuovo invio dello
   * stesso file dopo una caduta di rete: se il primo era arrivato ma la risposta no, il secondo
   * restituisce il media già salvato invece di duplicarlo. null per i caricamenti senza coda.
   */
  readonly clientUploadId: string | null;
  /** Dopo questo istante il file può essere eliminato dal disco (retention). */
  readonly expiresAt: IsoDateTime;
  /**
   * Quando il file è stato eliminato. Il record resta: nel fascicolo si continua a leggere che la
   * foto era stata scattata, con data e categoria, anche senza l'immagine.
   */
  readonly archivedAt: IsoDateTime | null;
}
