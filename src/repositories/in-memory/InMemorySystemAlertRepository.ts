// Segnalazioni di disfunzione in memoria.

import type { SystemAlert, SystemAlertStatus } from '@/domain/entities/system-alert';
import type { SystemAlertId } from '@/domain/ids';
import type {
  ISystemAlertRepository,
  SystemAlertFilter,
} from '../interfaces/ISystemAlertRepository';
import type { InMemoryStore } from './InMemoryStore';

function clone(a: SystemAlert): SystemAlert {
  return { ...a };
}

function byCreatedAtDesc(a: SystemAlert, b: SystemAlert): number {
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
}

export class InMemorySystemAlertRepository implements ISystemAlertRepository {
  constructor(private readonly store: InMemoryStore) {}

  private get map(): Map<string, SystemAlert> {
    return this.store.state.systemAlerts;
  }

  async insert(alert: SystemAlert): Promise<SystemAlert> {
    const stored = clone(alert);
    this.map.set(stored.id, stored);
    return clone(stored);
  }

  async update(alert: SystemAlert): Promise<SystemAlert> {
    const stored = clone(alert);
    this.map.set(stored.id, stored);
    return clone(stored);
  }

  async findById(id: SystemAlertId): Promise<SystemAlert | null> {
    const trovata = this.map.get(id);
    return trovata === undefined ? null : clone(trovata);
  }

  async list(filter: SystemAlertFilter): Promise<readonly SystemAlert[]> {
    const ammessi = filter.statuses === undefined ? null : new Set<string>(filter.statuses);
    return [...this.map.values()]
      .filter((a) => ammessi === null || ammessi.has(a.status))
      .sort(byCreatedAtDesc)
      .slice(0, Math.max(0, filter.limit))
      .map(clone);
  }

  async countByStatus(): Promise<Readonly<Record<SystemAlertStatus, number>>> {
    const conteggio: Record<SystemAlertStatus, number> = { NEW: 0, IN_PROGRESS: 0, RESOLVED: 0 };
    for (const a of this.map.values()) {
      conteggio[a.status] += 1;
    }
    return conteggio;
  }
}
