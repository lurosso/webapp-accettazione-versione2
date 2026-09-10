// Storage media in memoria (nessun file system nello scaffold).
// Convenzione nomi: <Porta senza I><Implementazione> → MediaStorageMock oggi,
// MediaStorageLocalDisk (.data/media, M5) e MediaStorageBlob (futuro) in services/real.

import type { DomainError } from '@/domain/errors';
import { domainError } from '@/domain/errors';
import type { Result } from '@/domain/result';
import { err, ok } from '@/domain/result';
import type { IMediaStorage, MediaPutInput } from '../interfaces/IMediaStorage';

interface StoredBlob {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}

/** Storage binario su Map. */
export class MediaStorageMock implements IMediaStorage {
  private readonly blobs = new Map<string, StoredBlob>();

  async put(
    input: MediaPutInput,
  ): Promise<Result<{ readonly key: string; readonly url: string }, DomainError>> {
    if (input.key.trim().length === 0) {
      return err(domainError('VALIDATION', 'La chiave del media è obbligatoria.'));
    }
    this.blobs.set(input.key, { bytes: input.bytes, mimeType: input.mimeType });
    return ok({ key: input.key, url: this.getUrl(input.key) });
  }

  getUrl(key: string): string {
    return `/api/v1/media/${encodeURIComponent(key)}`;
  }

  async delete(key: string): Promise<Result<void, DomainError>> {
    if (!this.blobs.has(key)) {
      return err(domainError('NOT_FOUND', `Media non trovato: "${key}".`));
    }
    this.blobs.delete(key);
    return ok(undefined);
  }

  /** Lettura diretta (per Route Handler e test). */
  get(key: string): StoredBlob | null {
    return this.blobs.get(key) ?? null;
  }

  /** Numero di binari memorizzati. */
  get size(): number {
    return this.blobs.size;
  }
}
