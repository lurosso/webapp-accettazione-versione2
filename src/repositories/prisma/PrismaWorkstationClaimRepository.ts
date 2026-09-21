// Chi è seduto a quale postazione, su SQLite. È la tabella che rende vero «il posto resta suo
// finché non esce»: prima viveva in memoria e un riavvio del server liberava tutti i banchi —
// comodo, ma falso.
import { isClaimActive, type WorkstationClaim } from '@/domain/entities/workstation-claim';
import type { OperatorId, WorkstationId } from '@/domain/ids';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import type { WorkstationClaim as Row } from '@/generated/prisma/client';
import type { IWorkstationClaimRepository } from '../interfaces/IWorkstationClaimRepository';
import type { Db } from './client';

function toEntity(r: Row): WorkstationClaim {
  return {
    workstationId: r.workstationId as WorkstationId,
    operatorId: r.operatorId as OperatorId,
    operatorName: r.operatorName,
    claimedAt: r.claimedAt as IsoDateTime,
    expiresAt: r.expiresAt as IsoDateTime,
  };
}

export class PrismaWorkstationClaimRepository implements IWorkstationClaimRepository {
  constructor(private readonly db: Db) {}

  async findByWorkstation(workstationId: WorkstationId): Promise<WorkstationClaim | null> {
    const r = await this.db.workstationClaim.findUnique({ where: { workstationId } });
    return r === null ? null : toEntity(r);
  }

  async listActive(now: IsoDateTime): Promise<readonly WorkstationClaim[]> {
    // La regola di validità sta nel dominio (`isClaimActive`): si legge tutto e si filtra lì,
    // così non esistono due definizioni di «attiva». Le postazioni sono quattro.
    const rows = await this.db.workstationClaim.findMany();
    return rows.map(toEntity).filter((c) => isClaimActive(c, now));
  }

  async upsert(claim: WorkstationClaim): Promise<WorkstationClaim> {
    const dati = {
      operatorId: claim.operatorId,
      operatorName: claim.operatorName,
      claimedAt: claim.claimedAt,
      expiresAt: claim.expiresAt,
    };
    return toEntity(
      await this.db.workstationClaim.upsert({
        where: { workstationId: claim.workstationId },
        create: { workstationId: claim.workstationId, ...dati },
        update: dati,
      }),
    );
  }

  async deleteByOperator(operatorId: OperatorId): Promise<void> {
    await this.db.workstationClaim.deleteMany({ where: { operatorId } });
  }

  async deleteByWorkstation(workstationId: WorkstationId): Promise<void> {
    await this.db.workstationClaim.deleteMany({ where: { workstationId } });
  }
}
