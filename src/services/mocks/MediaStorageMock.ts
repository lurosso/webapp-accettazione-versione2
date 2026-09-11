// Storage media in memoria (nessun file system nello scaffold).
// Convenzione nomi: <Porta senza I><Implementazione> → MediaStorageMock oggi,
// MediaStorageLocalDisk (.data/media) e MediaStorageBlob (futuro) in services/real.
import type { DomainError } from '@/domain/errors';
import { domainError } from '@/domain/errors';
import type { Result } from '@/domain/result';
import { err, ok } from '@/domain/result';
import type { IMediaStorage, MediaPutInput, StoredMedia } from '../interfaces/IMediaStorage';
import type { ILogger } from '../interfaces/ILogger';
import { simulateLatency } from './simulate';

interface StoredBlob {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}

export interface MediaStorageMockOptions {
  /**
   * Latenza simulata del salvataggio. Un archivio reale impiega un momento a ricevere una foto
   * da qualche megabyte: senza questa attesa il tablet mostrerebbe un caricamento istantaneo e
   * non si vedrebbe se l'interfaccia regge bene l'attesa.
   */
  readonly latencyMs: number;
}

export interface MediaStorageMockDeps {
  readonly logger: ILogger;
}

/** Storage binario su Map. */
export class MediaStorageMock implements IMediaStorage {
  private readonly blobs = new Map<string, StoredBlob>();
  private readonly logger: ILogger;

  constructor(
    private readonly options: MediaStorageMockOptions,
    deps: MediaStorageMockDeps,
  ) {
    this.logger = deps.logger.child('[MOCK][Media]');
  }

  async put(
    input: MediaPutInput,
  ): Promise<Result<{ readonly key: string; readonly url: string }, DomainError>> {
    if (input.key.trim().length === 0) {
      return err(domainError('VALIDATION', 'La chiave del media è obbligatoria.'));
    }
    await simulateLatency(this.options.latencyMs);
    this.blobs.set(input.key, { bytes: input.bytes, mimeType: input.mimeType });
    this.logger.info(`foto salvata: ${input.key}`, {
      mimeType: input.mimeType,
      sizeBytes: input.bytes.byteLength,
      totaleInMemoria: this.blobs.size,
    });
    return ok({ key: input.key, url: this.getUrl(input.key) });
  }

  async read(key: string): Promise<Result<StoredMedia, DomainError>> {
    const blob = this.blobs.get(key);
    if (blob === undefined) {
      return err(domainError('NOT_FOUND', `Media non trovato: "${key}".`));
    }
    return ok(blob);
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
