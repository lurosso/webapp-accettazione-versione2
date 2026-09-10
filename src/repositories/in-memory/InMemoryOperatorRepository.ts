// Repository degli operatori (seed demo) in memoria.

import type { Operator } from '@/domain/entities/operator';
import type { OperatorId } from '@/domain/ids';
import type { IOperatorRepository } from '../interfaces/IOperatorRepository';
import type { InMemoryStore } from './InMemoryStore';

/** Operatori in memoria. */
export class InMemoryOperatorRepository implements IOperatorRepository {
  constructor(private readonly store: InMemoryStore) {}

  async findById(id: OperatorId): Promise<Operator | null> {
    const found = this.store.state.operators.get(id);
    return found === undefined ? null : { ...found, deskIds: [...found.deskIds] };
  }

  async findByUsername(username: string): Promise<Operator | null> {
    const wanted = username.trim().toLowerCase();
    for (const o of this.store.state.operators.values()) {
      if (o.username.toLowerCase() === wanted) {
        return { ...o, deskIds: [...o.deskIds] };
      }
    }
    return null;
  }

  async listActive(): Promise<readonly Operator[]> {
    return [...this.store.state.operators.values()]
      .filter((o) => o.isActive)
      .map((o) => ({ ...o, deskIds: [...o.deskIds] }));
  }
}
