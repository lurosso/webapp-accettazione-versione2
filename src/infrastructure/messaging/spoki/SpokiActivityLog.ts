// Registro in memoria delle chiamate a Spoki: anello di dimensione fissa, le voci più vecchie
// escono da sole. Vive quanto il processo, come il resto dello stato in memoria (ADR sulla
// persistenza): serve a vedere subito cosa il sistema avrebbe inviato, non a fare storia.
import type { IIdGenerator } from '@/services/interfaces/IIdGenerator';
import type {
  ISpokiActivityLog,
  SpokiActivityEntry,
} from '@/services/interfaces/ISpokiActivityLog';

const GLOBAL_KEY = '__accettazioneSpokiActivityLog';

export class SpokiActivityLog implements ISpokiActivityLog {
  private readonly entries: SpokiActivityEntry[] = [];

  constructor(
    private readonly ids: IIdGenerator,
    private readonly maxEntries = 200,
  ) {}

  /**
   * Registro condiviso del processo, memoizzato su `globalThis` come lo store: in sviluppo l'HMR
   * ricostruisce il container e con lui il servizio Spoki, ma i payload già registrati (per esempio
   * i promemoria partiti dallo scheduler un minuto prima) devono restare leggibili dal pannello.
   */
  static getShared(ids: IIdGenerator, maxEntries = 200): SpokiActivityLog {
    const g = globalThis as unknown as Record<string, unknown>;
    const existing = g[GLOBAL_KEY];
    if (existing instanceof SpokiActivityLog) {
      return existing;
    }
    const created = new SpokiActivityLog(ids, maxEntries);
    g[GLOBAL_KEY] = created;
    return created;
  }

  record(entry: Omit<SpokiActivityEntry, 'id'>): SpokiActivityEntry {
    const completa: SpokiActivityEntry = { ...entry, id: this.ids.next() };
    this.entries.push(completa);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
    return completa;
  }

  list(limit = 100): readonly SpokiActivityEntry[] {
    return [...this.entries].reverse().slice(0, Math.max(0, limit));
  }

  clear(): void {
    this.entries.length = 0;
  }
}
