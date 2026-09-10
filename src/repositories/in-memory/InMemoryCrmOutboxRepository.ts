// Outbox CRM in memoria.

import type { CrmOutboxEvent, CrmOutboxStatus } from '@/domain/entities/crm-outbox-event';
import type { CrmOutboxEventId } from '@/domain/ids';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import type { ICrmOutboxRepository } from '../interfaces/ICrmOutboxRepository';
import type { InMemoryStore } from './InMemoryStore';

function clone(event: CrmOutboxEvent): CrmOutboxEvent {
  return { ...event, payload: { ...event.payload } };
}

function byCreatedAtAsc(a: CrmOutboxEvent, b: CrmOutboxEvent): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

/** Eventi CRM in memoria. */
export class InMemoryCrmOutboxRepository implements ICrmOutboxRepository {
  constructor(private readonly store: InMemoryStore) {}

  private get map(): Map<string, CrmOutboxEvent> {
    return this.store.state.crmOutbox;
  }

  async insert(event: CrmOutboxEvent): Promise<CrmOutboxEvent> {
    const stored = clone(event);
    this.map.set(stored.id, stored);
    return clone(stored);
  }

  async update(event: CrmOutboxEvent): Promise<CrmOutboxEvent> {
    const stored = clone(event);
    this.map.set(stored.id, stored);
    return clone(stored);
  }

  async findById(id: CrmOutboxEventId): Promise<CrmOutboxEvent | null> {
    const found = this.map.get(id);
    return found === undefined ? null : clone(found);
  }

  async findByIdempotencyKey(key: string): Promise<CrmOutboxEvent | null> {
    for (const e of this.map.values()) {
      if (e.idempotencyKey === key) {
        return clone(e);
      }
    }
    return null;
  }

  async listDue(now: IsoDateTime, limit: number): Promise<readonly CrmOutboxEvent[]> {
    return [...this.map.values()]
      .filter(
        (e) =>
          (e.status === 'PENDING' || e.status === 'FAILED') &&
          (e.nextAttemptAt === null || e.nextAttemptAt <= now),
      )
      .sort(byCreatedAtAsc)
      .slice(0, Math.max(0, limit))
      .map(clone);
  }

  async listByStatus(statuses: readonly CrmOutboxStatus[]): Promise<readonly CrmOutboxEvent[]> {
    return [...this.map.values()]
      .filter((e) => statuses.includes(e.status))
      .sort(byCreatedAtAsc)
      .map(clone);
  }
}
