// Occupazioni delle accettazioni in memoria (chiave: workstationId).

import type { WorkstationClaim } from '@/domain/entities/workstation-claim';
import { isClaimActive, isWorkstationClaim } from '@/domain/entities/workstation-claim';
import type { OperatorId, WorkstationId } from '@/domain/ids';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import type { IWorkstationClaimRepository } from '../interfaces/IWorkstationClaimRepository';
import type { InMemoryStore } from './InMemoryStore';

export class InMemoryWorkstationClaimRepository implements IWorkstationClaimRepository {
  constructor(private readonly store: InMemoryStore) {}

  async findByWorkstation(workstationId: WorkstationId): Promise<WorkstationClaim | null> {
    const found = this.store.state.workstationClaims.get(workstationId);
    return found === undefined ? null : { ...found };
  }

  async listActive(now: IsoDateTime): Promise<readonly WorkstationClaim[]> {
    return [...this.store.state.workstationClaims.values()]
      .filter((c) => isClaimActive(c, now) && isWorkstationClaim(c))
      .map((c) => ({ ...c }));
  }

  async upsert(claim: WorkstationClaim): Promise<WorkstationClaim> {
    const stored = { ...claim };
    this.store.state.workstationClaims.set(stored.workstationId, stored);
    return { ...stored };
  }

  async deleteByOperator(operatorId: OperatorId): Promise<void> {
    for (const [key, claim] of this.store.state.workstationClaims) {
      if (claim.operatorId === operatorId) {
        this.store.state.workstationClaims.delete(key);
      }
    }
  }

  async deleteByWorkstation(workstationId: WorkstationId): Promise<void> {
    this.store.state.workstationClaims.delete(workstationId);
  }
}
