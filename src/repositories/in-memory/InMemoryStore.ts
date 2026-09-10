// Contenitore unico dello stato condiviso in memoria (vincolo 7: tutti i client vedono
// la stessa coda). Lo STATO GREZZO vive in un "holder" su globalThis: sopravvive all'HMR
// di Next.js anche quando la classe InMemoryStore viene rivalutata (un controllo
// `instanceof` fallirebbe e creerebbe un secondo store vuoto). Ogni istanza ottenuta con
// getGlobal() condivide lo stesso holder, quindi reset()/loadSnapshot() sono visti da tutti.
// Snapshot/ripristino lavorano solo su dati: il file I/O (.data/state.json) arriva in M1.

import type { Appointment } from '@/domain/entities/appointment';
import type { Bay } from '@/domain/entities/bay';
import type { Brand } from '@/domain/entities/brand';
import type { CrmOutboxEvent } from '@/domain/entities/crm-outbox-event';
import type { Desk } from '@/domain/entities/desk';
import type { MediaAsset } from '@/domain/entities/media-asset';
import type { NotificationJob } from '@/domain/entities/notification';
import type { Operator } from '@/domain/entities/operator';
import type { SyncRun } from '@/domain/entities/sync-run';
import type { Workstation } from '@/domain/entities/workstation';
import type { SeedData } from '@/config/seed';

/**
 * Stato grezzo; le chiavi delle Map sono gli id. `sequences`: `${businessDate}|${prefix}` → ultimo numero.
 * Le Map sono mutate dai repository; gli array di riferimento sono sostituiti solo da `seedReferenceData`.
 */
export interface InMemoryStoreState {
  readonly appointments: Map<string, Appointment>;
  readonly sequences: Map<string, number>;
  readonly operators: Map<string, Operator>;
  readonly brands: readonly Brand[];
  readonly desks: readonly Desk[];
  readonly workstations: readonly Workstation[];
  readonly bays: readonly Bay[];
  readonly notificationJobs: Map<string, NotificationJob>;
  readonly syncRuns: Map<string, SyncRun>;
  readonly crmOutbox: Map<string, CrmOutboxEvent>;
  readonly media: Map<string, MediaAsset>;
}

/** Forma serializzata dello snapshot. */
interface StoreSnapshot {
  readonly version: 1;
  readonly appointments: readonly Appointment[];
  readonly sequences: readonly (readonly [string, number])[];
  readonly operators: readonly Operator[];
  readonly brands: readonly Brand[];
  readonly desks: readonly Desk[];
  readonly workstations: readonly Workstation[];
  readonly bays: readonly Bay[];
  readonly notificationJobs: readonly NotificationJob[];
  readonly syncRuns: readonly SyncRun[];
  readonly crmOutbox: readonly CrmOutboxEvent[];
  readonly media: readonly MediaAsset[];
}

/** Contenitore mutabile dello stato, condiviso fra le istanze che puntano allo stesso globale. */
interface StateHolder {
  state: InMemoryStoreState;
}

const GLOBAL_KEY = '__accettazioneStore';

function emptyState(): InMemoryStoreState {
  return {
    appointments: new Map(),
    sequences: new Map(),
    operators: new Map(),
    brands: [],
    desks: [],
    workstations: [],
    bays: [],
    notificationJobs: new Map(),
    syncRuns: new Map(),
    crmOutbox: new Map(),
    media: new Map(),
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isArrayOfRecords(v: unknown): v is Record<string, unknown>[] {
  return Array.isArray(v) && v.every(isRecord);
}

/** Controllo STRUTTURALE (non `instanceof`): resiste alla rivalutazione del modulo con l'HMR. */
function isStateHolder(v: unknown): v is StateHolder {
  return isRecord(v) && isRecord(v['state']) && v['state']['appointments'] instanceof Map;
}

/** Store in memoria condiviso da tutti i repository in-memory. */
export class InMemoryStore {
  private constructor(private readonly holder: StateHolder) {}

  /** Stato corrente (lettura; le Map sono mutate dai repository, gli array sono readonly). */
  get state(): InMemoryStoreState {
    return this.holder.state;
  }

  /** Istanza agganciata allo stato globale del processo (creato al primo accesso). */
  static getGlobal(): InMemoryStore {
    const g = globalThis as unknown as Record<string, unknown>;
    const existing = g[GLOBAL_KEY];
    if (isStateHolder(existing)) {
      return new InMemoryStore(existing);
    }
    const holder: StateHolder = { state: emptyState() };
    g[GLOBAL_KEY] = holder;
    return new InMemoryStore(holder);
  }

  /** Istanza isolata (test): non tocca il singleton. */
  static createIsolated(): InMemoryStore {
    return new InMemoryStore({ state: emptyState() });
  }

  /** Svuota tutto lo stato, dati di riferimento inclusi. */
  reset(): void {
    this.holder.state = emptyState();
  }

  /** Indica se i dati di riferimento sono già stati caricati. */
  hasReferenceData(): boolean {
    return this.state.brands.length > 0;
  }

  /** Carica marchi, sportelli, postazioni, campate e operatori dal seed (sostituendo i precedenti). */
  seedReferenceData(seed: SeedData): void {
    this.holder.state = {
      ...this.state,
      brands: [...seed.brands],
      desks: [...seed.desks],
      workstations: [...seed.workstations],
      bays: [...seed.bays],
      operators: new Map(seed.operators.map((o) => [o.id, o])),
    };
  }

  /** Serializza lo stato in un oggetto JSON-compatibile (nessun file I/O qui). */
  toSnapshot(): unknown {
    const s = this.state;
    const snapshot: StoreSnapshot = {
      version: 1,
      appointments: [...s.appointments.values()],
      sequences: [...s.sequences.entries()],
      operators: [...s.operators.values()],
      brands: [...s.brands],
      desks: [...s.desks],
      workstations: [...s.workstations],
      bays: [...s.bays],
      notificationJobs: [...s.notificationJobs.values()],
      syncRuns: [...s.syncRuns.values()],
      crmOutbox: [...s.crmOutbox.values()],
      media: [...s.media.values()],
    };
    return snapshot;
  }

  /**
   * Ripristina lo stato da uno snapshot. Validazione strutturale (non semantica):
   * restituisce `false` e lascia lo stato intatto se la forma non è riconosciuta.
   */
  loadSnapshot(v: unknown): boolean {
    if (!isRecord(v) || v['version'] !== 1) {
      return false;
    }
    const lists = [
      'appointments',
      'operators',
      'brands',
      'desks',
      'workstations',
      'bays',
      'notificationJobs',
      'syncRuns',
      'crmOutbox',
      'media',
    ] as const;
    for (const key of lists) {
      if (!isArrayOfRecords(v[key])) {
        return false;
      }
    }
    const sequences = v['sequences'];
    if (
      !Array.isArray(sequences) ||
      !sequences.every(
        (entry: unknown) =>
          Array.isArray(entry) &&
          entry.length === 2 &&
          typeof entry[0] === 'string' &&
          typeof entry[1] === 'number',
      )
    ) {
      return false;
    }

    const snap = v as unknown as StoreSnapshot;
    const byId = <T extends { readonly id: string }>(items: readonly T[]): Map<string, T> =>
      new Map(items.map((item) => [item.id, item]));

    this.holder.state = {
      appointments: byId(snap.appointments),
      sequences: new Map(snap.sequences),
      operators: byId(snap.operators),
      brands: [...snap.brands],
      desks: [...snap.desks],
      workstations: [...snap.workstations],
      bays: [...snap.bays],
      notificationJobs: byId(snap.notificationJobs),
      syncRuns: byId(snap.syncRuns),
      crmOutbox: byId(snap.crmOutbox),
      media: byId(snap.media),
    };
    return true;
  }
}
