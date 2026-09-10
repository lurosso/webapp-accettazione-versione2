// Storico delle SyncRun in memoria.

import type { SyncRun } from '@/domain/entities/sync-run';
import type { IsoDate } from '@/domain/value-objects/iso-date';
import type { ISyncRunRepository } from '../interfaces/ISyncRunRepository';
import type { InMemoryStore } from './InMemoryStore';

function clone(run: SyncRun): SyncRun {
  return { ...run, counters: { ...run.counters } };
}

function byStartedAtDesc(a: SyncRun, b: SyncRun): number {
  return a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0;
}

/** SyncRun in memoria. */
export class InMemorySyncRunRepository implements ISyncRunRepository {
  constructor(private readonly store: InMemoryStore) {}

  private get map(): Map<string, SyncRun> {
    return this.store.state.syncRuns;
  }

  async insert(run: SyncRun): Promise<SyncRun> {
    const stored = clone(run);
    this.map.set(stored.id, stored);
    return clone(stored);
  }

  async update(run: SyncRun): Promise<SyncRun> {
    const stored = clone(run);
    this.map.set(stored.id, stored);
    return clone(stored);
  }

  async findLatest(businessDate: IsoDate): Promise<SyncRun | null> {
    const runs = [...this.map.values()]
      .filter((r) => r.businessDate === businessDate)
      .sort(byStartedAtDesc);
    const latest = runs[0];
    return latest === undefined ? null : clone(latest);
  }

  async findLastSuccessful(businessDate: IsoDate): Promise<SyncRun | null> {
    const runs = [...this.map.values()]
      .filter(
        (r) => r.businessDate === businessDate && (r.status === 'SUCCESS' || r.status === 'PARTIAL'),
      )
      .sort(byStartedAtDesc);
    const latest = runs[0];
    return latest === undefined ? null : clone(latest);
  }

  async listRecent(limit: number): Promise<readonly SyncRun[]> {
    return [...this.map.values()].sort(byStartedAtDesc).slice(0, Math.max(0, limit)).map(clone);
  }
}
