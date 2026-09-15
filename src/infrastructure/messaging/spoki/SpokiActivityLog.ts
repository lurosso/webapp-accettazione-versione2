// Registro in memoria delle chiamate a Spoki: anello di dimensione fissa, le voci più vecchie
// escono da sole. Vive quanto il processo, come il resto dello stato in memoria (ADR sulla
// persistenza): serve a vedere subito cosa il sistema avrebbe inviato, non a fare storia.
import type { IIdGenerator } from '@/services/interfaces/IIdGenerator';
import type {
  ISpokiActivityLog,
  SpokiActivityEntry,
} from '@/services/interfaces/ISpokiActivityLog';

export class SpokiActivityLog implements ISpokiActivityLog {
  private readonly entries: SpokiActivityEntry[] = [];

  constructor(
    private readonly ids: IIdGenerator,
    private readonly maxEntries = 200,
  ) {}

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
