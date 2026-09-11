// Storage dei media su disco locale (modulo E): le foto scattate al tablet restano sul server
// dell'officina anche dopo un riavvio, al contrario del mock in memoria.
//
// Scelte dettate dall'ambiente in cui gira: una sola macchina in officina, niente cloud.
// - scrittura atomica (file temporaneo + rename): un crash a metà caricamento non lascia una foto
//   troncata nel fascicolo, o c'è tutta o non c'è;
// - chiave = percorso relativo (`<giornata>/<codice>/<id>.<estensione>`), così sfogliando la
//   cartella si ritrova a mano la pratica di un cliente senza aprire il database;
// - nessuna chiave può uscire dalla cartella base: i tentativi con `..` o percorsi assoluti sono
//   rifiutati come errore di validazione, non ripuliti in silenzio.
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import type { DomainError } from '@/domain/errors';
import { domainError } from '@/domain/errors';
import type { Result } from '@/domain/result';
import { err, ok } from '@/domain/result';
import type { IIdGenerator } from '../interfaces/IIdGenerator';
import type { ILogger } from '../interfaces/ILogger';
import type { IMediaStorage, MediaPutInput, StoredMedia } from '../interfaces/IMediaStorage';

/** Estensione da usare per ogni tipo accettato (la chiave la porta sempre con sé). */
const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'video/mp4': 'mp4',
};

/** Tipo da restituire in lettura, ricavato dall'estensione della chiave. */
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  mp4: 'video/mp4',
};

const FALLBACK_MIME = 'application/octet-stream';

/** Chiave ammessa: segmenti alfanumerici separati da "/", nessun percorso assoluto, nessun "..". */
const KEY_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface MediaStorageLocalDiskOptions {
  /** Cartella base dei file (relativa alla radice del progetto o assoluta). */
  readonly baseDir: string;
}

export interface MediaStorageLocalDiskDeps {
  readonly ids: IIdGenerator;
  readonly logger: ILogger;
}

function extensionOf(key: string): string {
  const nome = key.slice(key.lastIndexOf('/') + 1);
  const punto = nome.lastIndexOf('.');
  return punto <= 0 ? '' : nome.slice(punto + 1).toLowerCase();
}

/** Messaggio di errore di un guasto del file system, senza far uscire eccezioni. */
function fileSystemMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function isNotFound(cause: unknown): boolean {
  return (cause as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

export class MediaStorageLocalDisk implements IMediaStorage {
  private readonly baseDir: string;
  private readonly logger: ILogger;

  constructor(
    options: MediaStorageLocalDiskOptions,
    private readonly deps: MediaStorageLocalDiskDeps,
  ) {
    this.baseDir = resolve(options.baseDir);
    this.logger = deps.logger.child('[Media]');
  }

  /** Cartella base risolta (utile a log e diagnostica). */
  get directory(): string {
    return this.baseDir;
  }

  async put(
    input: MediaPutInput,
  ): Promise<Result<{ readonly key: string; readonly url: string }, DomainError>> {
    // La chiave deve portare l'estensione del proprio tipo: così la rilettura sa cosa servire
    // senza tenere un secondo file di metadati accanto a ogni foto.
    const attesa = EXTENSION_BY_MIME[input.mimeType];
    const chiave =
      attesa !== undefined && MIME_BY_EXTENSION[extensionOf(input.key)] !== input.mimeType
        ? `${input.key}.${attesa}`
        : input.key;

    const percorso = this.resolveKey(chiave);
    if (!percorso.ok) {
      return percorso;
    }
    if (input.bytes.byteLength === 0) {
      return err(domainError('VALIDATION', 'Il file da salvare è vuoto.'));
    }

    // Temporaneo nella stessa cartella: il rename finale è atomico solo sullo stesso disco.
    const temporaneo = `${percorso.value}.${this.deps.ids.next()}.part`;
    try {
      await mkdir(dirname(percorso.value), { recursive: true });
      await writeFile(temporaneo, input.bytes);
      await rename(temporaneo, percorso.value);
    } catch (cause) {
      this.logger.error(`file non salvato: ${chiave}`, { errore: fileSystemMessage(cause) });
      await unlink(temporaneo).catch(() => undefined);
      return err(
        domainError('INTERNAL', 'Non è stato possibile salvare il file sul disco.', {
          key: chiave,
          errore: fileSystemMessage(cause),
        }),
      );
    }

    this.logger.info(`file salvato: ${chiave}`, {
      mimeType: input.mimeType,
      sizeBytes: input.bytes.byteLength,
      percorso: percorso.value,
    });
    return ok({ key: chiave, url: this.getUrl(chiave) });
  }

  async read(key: string): Promise<Result<StoredMedia, DomainError>> {
    const percorso = this.resolveKey(key);
    if (!percorso.ok) {
      return percorso;
    }
    try {
      const contenuto = await readFile(percorso.value);
      return ok({
        bytes: new Uint8Array(contenuto),
        mimeType: MIME_BY_EXTENSION[extensionOf(key)] ?? FALLBACK_MIME,
      });
    } catch (cause) {
      if (isNotFound(cause)) {
        return err(domainError('NOT_FOUND', `File non trovato: "${key}".`));
      }
      this.logger.error(`file non leggibile: ${key}`, { errore: fileSystemMessage(cause) });
      return err(
        domainError('INTERNAL', 'Non è stato possibile leggere il file dal disco.', { key }),
      );
    }
  }

  getUrl(key: string): string {
    return `/api/v1/media/${encodeURIComponent(key)}`;
  }

  async delete(key: string): Promise<Result<void, DomainError>> {
    const percorso = this.resolveKey(key);
    if (!percorso.ok) {
      return percorso;
    }
    try {
      await unlink(percorso.value);
      return ok(undefined);
    } catch (cause) {
      if (isNotFound(cause)) {
        return err(domainError('NOT_FOUND', `File non trovato: "${key}".`));
      }
      return err(
        domainError('INTERNAL', 'Non è stato possibile eliminare il file dal disco.', { key }),
      );
    }
  }

  /** Percorso assoluto della chiave, garantito dentro la cartella base. */
  private resolveKey(key: string): Result<string, DomainError> {
    const pulita = key.trim();
    const segmenti = pulita.split('/');
    const valida =
      pulita.length > 0 &&
      !isAbsolute(pulita) &&
      !pulita.includes('\\') &&
      segmenti.length <= 8 &&
      segmenti.every((segmento) => KEY_SEGMENT.test(segmento));
    if (!valida) {
      return err(domainError('VALIDATION', `Chiave del media non valida: "${key}".`));
    }
    const percorso = resolve(this.baseDir, pulita);
    if (percorso !== this.baseDir && !percorso.startsWith(this.baseDir + sep)) {
      return err(domainError('VALIDATION', `Chiave del media non valida: "${key}".`));
    }
    return ok(percorso);
  }
}
