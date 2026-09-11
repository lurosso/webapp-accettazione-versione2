// Storage binario astratto per foto/video (P5): memoria ora, disco locale in M5, blob poi.

import type { DomainError } from '@/domain/errors';
import type { Result } from '@/domain/result';

/** Input di caricamento di un media. */
export interface MediaPutInput {
  readonly key: string;
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}

/** Byte e tipo di un media salvato: quanto basta alla rotta di lettura per servirlo. */
export interface StoredMedia {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}

/** Storage dei binari; i metadati vivono in IMediaRepository. */
export interface IMediaStorage {
  /** Salva i byte e restituisce chiave e URL di lettura. */
  put(
    input: MediaPutInput,
  ): Promise<Result<{ readonly key: string; readonly url: string }, DomainError>>;
  /** Rilegge i byte salvati; NOT_FOUND se la chiave non esiste. */
  read(key: string): Promise<Result<StoredMedia, DomainError>>;
  /** URL pubblico (autenticato) di lettura della chiave. */
  getUrl(key: string): string;
  /** Elimina il binario. */
  delete(key: string): Promise<Result<void, DomainError>>;
}
