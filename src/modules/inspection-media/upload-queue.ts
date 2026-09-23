// Coda dei caricamenti dal tablet: una foto o un video scattati non si perdono mai.
//
// Sul piazzale la rete va e viene (il Wi-Fi arriva a metà, sotto la tettoia non arriva). Prima un
// invio fallito faceva sparire il media con un errore, e l'accettatore doveva rifare lo scatto —
// se se ne accorgeva. Qui il file entra PRIMA in un archivio locale (IndexedDB) e POI parte:
// se la rete cade si riprova da soli con un'attesa crescente (2, 4, 8… fino a 60 secondi), subito
// quando il tablet torna in linea, e anche dopo aver chiuso e riaperto la pagina.
//
// Ogni file ha un identificativo scelto qui (`idCaricamento`): se la risposta del server si perde
// ma il file era arrivato, il nuovo invio non crea un doppione — il server riconosce l'id e
// risponde con il media già salvato.
//
// Tre esiti per un tentativo fallito:
// - rete assente, timeout, server occupato o guasto (408, 425, 429, 5xx): si riprova da soli;
// - sessione scaduta (401): si aspetta che l'operatore rientri, i file restano sul tablet;
// - rifiuto definitivo (file troppo grande, formato non ammesso, check-in già chiuso): si ferma e
//   chiede all'operatore se riprovare o scartare, perché riprovare da soli non cambierebbe niente.
//
// Qui non c'è React né il browser: tempo, rete, archivio e invio arrivano da fuori, così la logica
// si prova in Node. L'archivio IndexedDB e l'invio vero stanno in `upload-store.ts`.
import type { MediaCategory } from '@/domain/entities/media-asset';
import type { InspectionPhoto } from '@/lib/api-client/client';

export type PendingUploadStatus =
  /** In fila per partire. */
  | 'QUEUED'
  /** In viaggio adesso (`progress` dice a che punto). */
  | 'UPLOADING'
  /** L'ultimo tentativo non è arrivato: riparte da solo a `nextAttemptAt` o quando torna la rete. */
  | 'WAITING_NETWORK'
  /** Sessione scaduta: riparte dopo il nuovo accesso (si riprova comunque ogni minuto). */
  | 'WAITING_AUTH'
  /** Rifiutato dal server: aspetta che l'operatore scelga fra riprovare e scartare. */
  | 'FAILED';

/** Un file acquisito e non ancora salvato sul server. */
export interface PendingUpload {
  /** Identificativo del caricamento, inviato come `idCaricamento`: rende idempotente il nuovo invio. */
  readonly id: string;
  readonly appointmentId: string;
  readonly category: MediaCategory | null;
  readonly kind: 'PHOTO' | 'VIDEO';
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly blob: Blob;
  /** Millisecondi epoch dell'acquisizione (ordine di invio). */
  readonly createdAt: number;
  readonly attempts: number;
  readonly status: PendingUploadStatus;
  /** Millisecondi epoch del prossimo tentativo automatico; null = appena possibile. */
  readonly nextAttemptAt: number | null;
  /** Da 0 a 1 durante l'invio. */
  readonly progress: number;
  readonly lastError: string | null;
}

/** Archivio locale dei file in attesa. Deve sopravvivere al ricaricamento della pagina. */
export interface UploadStore {
  /** true se i file restano sul tablet anche chiudendo la pagina (IndexedDB), false se in memoria. */
  readonly persistent: boolean;
  list(): Promise<readonly PendingUpload[]>;
  put(upload: PendingUpload): Promise<void>;
  delete(id: string): Promise<void>;
}

/** Esito di un invio: il media salvato, oppure lo stato HTTP (null = la rete non ha risposto). */
export type UploadAttemptResult =
  | { readonly ok: true; readonly media: InspectionPhoto }
  | { readonly ok: false; readonly status: number | null; readonly message: string };

export type Uploader = (
  upload: PendingUpload,
  onProgress: (fraction: number) => void,
) => Promise<UploadAttemptResult>;

export type UploadFailureClass = 'retry' | 'auth' | 'permanent';

/** Attesa prima del prossimo tentativo: 2, 4, 8, 16, 32 secondi, poi sempre 60. */
export const UPLOAD_RETRY_MAX_MS = 60_000;

export function retryDelayMs(attempts: number): number {
  const esponente = Math.max(0, attempts - 1);
  return Math.min(UPLOAD_RETRY_MAX_MS, 2_000 * 2 ** Math.min(esponente, 10));
}

/** Cosa fare dopo un tentativo fallito, dallo stato HTTP (null = nessuna risposta dalla rete). */
export function classifyUploadFailure(status: number | null): UploadFailureClass {
  if (status === null || status === 0) {
    return 'retry';
  }
  if (status === 401) {
    return 'auth';
  }
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return 'retry';
  }
  return 'permanent';
}

export interface UploadQueueDeps {
  readonly store: UploadStore;
  readonly upload: Uploader;
  readonly now?: () => number;
  readonly isOnline?: () => boolean;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  readonly newId?: () => string;
}

export interface EnqueueInput {
  readonly appointmentId: string;
  readonly blob: Blob;
  readonly fileName: string;
  readonly category: MediaCategory | null;
  readonly kind: 'PHOTO' | 'VIDEO';
}

type SnapshotListener = () => void;
type UploadedListener = (appointmentId: string, media: InspectionPhoto) => void;

/**
 * Identificativo di un caricamento (UUID v4). `crypto.randomUUID` c'è solo nei contesti sicuri
 * (HTTPS, localhost): sulla LAN dell'officina in HTTP l'iPad non lo espone, e allora si compone lo
 * stesso formato da `getRandomValues`, che c'è ovunque.
 */
export function newUploadId(): string {
  const c: Crypto | undefined = globalThis.crypto;
  if (c !== undefined && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID();
    } catch {
      // Contesto non sicuro: si prosegue con getRandomValues.
    }
  }
  const b = new Uint8Array(16);
  if (c !== undefined && typeof c.getRandomValues === 'function') {
    c.getRandomValues(b);
  } else {
    for (let i = 0; i < b.length; i += 1) {
      b[i] = Math.floor(Math.random() * 256);
    }
  }
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Attesa dopo un 401: la sessione si rinnova a mano, non ha senso martellare il server. */
const AUTH_RETRY_MS = 60_000;

export class UploadQueue {
  private items = new Map<string, PendingUpload>();
  private snapshotCache: readonly PendingUpload[] = [];
  private readonly listeners = new Set<SnapshotListener>();
  private readonly uploadedListeners = new Set<UploadedListener>();
  private running = false;
  private timer: unknown = null;
  private initialized: Promise<void> | null = null;
  private readonly now: () => number;
  private readonly isOnline: () => boolean;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly newId: () => string;

  constructor(private readonly deps: UploadQueueDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.isOnline = deps.isOnline ?? (() => true);
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.newId = deps.newId ?? newUploadId;
  }

  get persistent(): boolean {
    return this.deps.store.persistent;
  }

  /**
   * Riprende quello che era rimasto sul tablet (anche da una sessione precedente) e lo rimette in
   * viaggio. Un file che risultava «in viaggio» quando la pagina si è chiusa riparte da capo: il
   * server riconosce l'id se era arrivato. Chiamarla più volte non fa danni.
   */
  init(): Promise<void> {
    if (this.initialized === null) {
      this.initialized = (async () => {
        let salvati: readonly PendingUpload[] = [];
        try {
          salvati = await this.deps.store.list();
        } catch {
          salvati = [];
        }
        for (const u of salvati) {
          const ripreso: PendingUpload =
            u.status === 'UPLOADING' ? { ...u, status: 'QUEUED', progress: 0 } : u;
          // Un file accodato in questa sessione prima della ripresa resta com'è.
          if (!this.items.has(u.id)) {
            this.items.set(u.id, ripreso);
          }
        }
        this.emit();
        this.kick();
      })();
    }
    return this.initialized;
  }

  /** Tutti i file in attesa, dai più vecchi. Stessa identità finché non cambia niente. */
  snapshot(): readonly PendingUpload[] {
    return this.snapshotCache;
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Avvisa quando un file è stato salvato sul server (per aggiungerlo al fascicolo a schermo). */
  onUploaded(listener: UploadedListener): () => void {
    this.uploadedListeners.add(listener);
    return () => this.uploadedListeners.delete(listener);
  }

  /** Mette in sicurezza il file sul tablet e lo fa partire. Restituisce l'id del caricamento. */
  async enqueue(input: EnqueueInput): Promise<string> {
    const id = this.newId();
    const upload: PendingUpload = {
      id,
      appointmentId: input.appointmentId,
      category: input.category,
      kind: input.kind,
      fileName: input.fileName,
      mimeType: input.blob.type,
      sizeBytes: input.blob.size,
      blob: input.blob,
      createdAt: this.now(),
      attempts: 0,
      status: 'QUEUED',
      nextAttemptAt: null,
      progress: 0,
      lastError: null,
    };
    this.items.set(id, upload);
    this.emit();
    await this.save(upload);
    this.kick();
    return id;
  }

  /** «Riprova ora»: senza aspettare l'attesa, anche per un file rifiutato. */
  retryNow(id?: string): void {
    for (const u of this.items.values()) {
      if (id !== undefined && u.id !== id) {
        continue;
      }
      if (u.status !== 'UPLOADING') {
        this.set({ ...u, status: 'QUEUED', nextAttemptAt: null, lastError: null });
      }
    }
    this.kick();
  }

  /** «Scarta»: il file non verrà più inviato e sparisce dal tablet. */
  async discard(id: string): Promise<void> {
    const u = this.items.get(id);
    if (u === undefined || u.status === 'UPLOADING') {
      return;
    }
    this.items.delete(id);
    this.emit();
    await this.deps.store.delete(id).catch(() => undefined);
  }

  /** Il tablet è tornato in linea (o la pagina di nuovo visibile): chi aspettava la rete riparte. */
  networkBack(): void {
    for (const u of this.items.values()) {
      if (u.status === 'WAITING_NETWORK' || u.status === 'WAITING_AUTH') {
        this.set({ ...u, nextAttemptAt: null });
      }
    }
    this.kick();
  }

  /** Fa girare la coda se non sta già girando. Un file alla volta: la banda del piazzale è poca. */
  kick(): void {
    if (this.running) {
      return;
    }
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    this.running = true;
    void this.drain().finally(() => {
      this.running = false;
      this.schedule();
    });
  }

  private async drain(): Promise<void> {
    for (;;) {
      if (!this.isOnline()) {
        return;
      }
      const prossimo = this.nextDue();
      if (prossimo === null) {
        return;
      }
      await this.attempt(prossimo);
    }
  }

  private nextDue(): PendingUpload | null {
    const adesso = this.now();
    let scelto: PendingUpload | null = null;
    for (const u of this.items.values()) {
      if (u.status === 'FAILED' || u.status === 'UPLOADING') {
        continue;
      }
      if (u.nextAttemptAt !== null && u.nextAttemptAt > adesso) {
        continue;
      }
      if (scelto === null || u.createdAt < scelto.createdAt) {
        scelto = u;
      }
    }
    return scelto;
  }

  private async attempt(u: PendingUpload): Promise<void> {
    const inViaggio: PendingUpload = {
      ...u,
      status: 'UPLOADING',
      attempts: u.attempts + 1,
      progress: 0,
    };
    this.set(inViaggio);
    let esito: UploadAttemptResult;
    try {
      esito = await this.deps.upload(inViaggio, (fraction) => {
        const corrente = this.items.get(u.id);
        if (corrente !== undefined && corrente.status === 'UPLOADING') {
          this.set({ ...corrente, progress: Math.max(0, Math.min(1, fraction)) }, false);
        }
      });
    } catch (cause) {
      esito = {
        ok: false,
        status: null,
        message: cause instanceof Error ? cause.message : 'Invio interrotto.',
      };
    }

    if (!this.items.has(u.id)) {
      return;
    }
    if (esito.ok) {
      this.items.delete(u.id);
      this.emit();
      await this.deps.store.delete(u.id).catch(() => undefined);
      for (const l of this.uploadedListeners) {
        l(u.appointmentId, esito.media);
      }
      return;
    }

    const classe = classifyUploadFailure(esito.status);
    const dopo: PendingUpload =
      classe === 'permanent'
        ? {
            ...inViaggio,
            status: 'FAILED',
            nextAttemptAt: null,
            progress: 0,
            lastError: esito.message,
          }
        : classe === 'auth'
          ? {
              ...inViaggio,
              status: 'WAITING_AUTH',
              nextAttemptAt: this.now() + AUTH_RETRY_MS,
              progress: 0,
              lastError: esito.message,
            }
          : {
              ...inViaggio,
              status: 'WAITING_NETWORK',
              nextAttemptAt: this.now() + retryDelayMs(inViaggio.attempts),
              progress: 0,
              lastError: esito.message,
            };
    this.set(dopo);
    await this.save(dopo);
  }

  /** Programma il risveglio per il prossimo tentativo in attesa. */
  private schedule(): void {
    let primo: number | null = null;
    for (const u of this.items.values()) {
      if (u.status === 'FAILED' || u.status === 'UPLOADING') {
        continue;
      }
      const quando = u.nextAttemptAt ?? this.now();
      primo = primo === null ? quando : Math.min(primo, quando);
    }
    if (primo === null) {
      return;
    }
    // Offline: niente timer a vuoto, riparte con `networkBack()`. Un timer lungo resta comunque,
    // perché l'evento «online» su iPad non è sempre affidabile.
    const attesa = this.isOnline() ? Math.max(0, primo - this.now()) : UPLOAD_RETRY_MAX_MS;
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.kick();
    }, attesa);
  }

  private set(u: PendingUpload, persist = false): void {
    this.items.set(u.id, u);
    this.emit();
    if (persist) {
      void this.save(u);
    }
  }

  private async save(u: PendingUpload): Promise<void> {
    try {
      await this.deps.store.put(u);
    } catch {
      // Archivio pieno o negato: il file resta in memoria finché la pagina è aperta, e parte lo
      // stesso. Meglio un file che viaggia senza copia locale che un file perso.
    }
  }

  private emit(): void {
    this.snapshotCache = [...this.items.values()].sort((a, b) => a.createdAt - b.createdAt);
    for (const l of this.listeners) {
      l();
    }
  }
}

/** Archivio in memoria: il ripiego quando IndexedDB non c'è (e l'archivio dei test). */
export class MemoryUploadStore implements UploadStore {
  readonly persistent = false;
  private readonly data = new Map<string, PendingUpload>();

  list(): Promise<readonly PendingUpload[]> {
    return Promise.resolve([...this.data.values()]);
  }

  put(upload: PendingUpload): Promise<void> {
    this.data.set(upload.id, upload);
    return Promise.resolve();
  }

  delete(id: string): Promise<void> {
    this.data.delete(id);
    return Promise.resolve();
  }
}
