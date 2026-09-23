'use client';

// Il lato browser della coda dei caricamenti: l'archivio IndexedDB dove i file aspettano la rete,
// l'invio vero (XHR, per avere l'avanzamento) e l'unica coda della pagina, che si sveglia quando
// il tablet torna in linea o la pagina torna in primo piano.
//
// Una coda sola per tutta la pagina, non una per schermata: un video che sta partendo continua a
// partire anche se l'accettatore torna alla coda con «Salta per ora» e apre un'altra pratica.
import { sendInspectionMedia } from '@/lib/api-client/client';
import {
  MemoryUploadStore,
  UploadQueue,
  type PendingUpload,
  type UploadStore,
} from './upload-queue';

const DB_NAME = 'accettazione-upload';
const DB_VERSION = 1;
const STORE = 'uploads';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('appointmentId', 'appointmentId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB non disponibile'));
    req.onblocked = () => reject(new Error('IndexedDB bloccato da un’altra scheda'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('transazione IndexedDB fallita'));
    tx.onabort = () => reject(tx.error ?? new Error('transazione IndexedDB annullata'));
  });
}

/** File in attesa conservati sul tablet: restano anche chiudendo la pagina o spegnendo lo schermo. */
class IndexedDbUploadStore implements UploadStore {
  readonly persistent = true;

  constructor(private readonly db: IDBDatabase) {}

  async list(): Promise<readonly PendingUpload[]> {
    const tx = this.db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    await done(tx);
    return (req.result as PendingUpload[]) ?? [];
  }

  async put(upload: PendingUpload): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(upload);
    await done(tx);
  }

  async delete(id: string): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    await done(tx);
  }
}

/**
 * Archivio che parte in memoria e passa a IndexedDB appena il database è aperto. Così il primo
 * scatto non aspetta l'apertura del database, e un browser senza IndexedDB (navigazione privata
 * su un vecchio Safari) funziona lo stesso, solo senza copia sul tablet.
 */
class BrowserUploadStore implements UploadStore {
  private readonly memoria = new MemoryUploadStore();
  private idb: IndexedDbUploadStore | null = null;
  private readonly pronto: Promise<void>;

  constructor() {
    this.pronto =
      typeof indexedDB === 'undefined'
        ? Promise.resolve()
        : openDb()
            .then((db) => {
              this.idb = new IndexedDbUploadStore(db);
            })
            .catch(() => {
              this.idb = null;
            });
  }

  get persistent(): boolean {
    return this.idb !== null;
  }

  async list(): Promise<readonly PendingUpload[]> {
    await this.pronto;
    return this.idb === null ? this.memoria.list() : this.idb.list();
  }

  async put(upload: PendingUpload): Promise<void> {
    await this.pronto;
    await (this.idb ?? this.memoria).put(upload);
  }

  async delete(id: string): Promise<void> {
    await this.pronto;
    await (this.idb ?? this.memoria).delete(id);
  }
}

let coda: UploadQueue | null = null;
const anteprime = new Map<string, string>();

/**
 * Indirizzo locale dell'anteprima di un file in coda. Uno per file, creato alla prima richiesta e
 * liberato quando il file lascia la coda (salvato o scartato): le anteprime occupano memoria, e un
 * giro di trenta foto su un iPad se ne accorge.
 */
export function previewUrlFor(upload: PendingUpload): string | null {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return null;
  }
  let url = anteprime.get(upload.id);
  if (url === undefined) {
    url = URL.createObjectURL(upload.blob);
    anteprime.set(upload.id, url);
  }
  return url;
}

function liberaAnteprime(vivi: readonly PendingUpload[]): void {
  const ids = new Set(vivi.map((u) => u.id));
  for (const [id, url] of anteprime) {
    if (!ids.has(id)) {
      URL.revokeObjectURL(url);
      anteprime.delete(id);
    }
  }
}

/** La coda della pagina, creata al primo uso e risvegliata dagli eventi di rete e di visibilità. */
export function getUploadQueue(): UploadQueue {
  if (coda !== null) {
    return coda;
  }
  const q = new UploadQueue({
    store: new BrowserUploadStore(),
    upload: (u, onProgress) =>
      sendInspectionMedia({
        appointmentId: u.appointmentId,
        blob: u.blob,
        fileName: u.fileName,
        category: u.category,
        uploadId: u.id,
        onProgress,
      }),
    isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
  });
  q.subscribe(() => liberaAnteprime(q.snapshot()));
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => q.networkBack());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        q.networkBack();
      }
    });
  }
  coda = q;
  void q.init();
  return q;
}
