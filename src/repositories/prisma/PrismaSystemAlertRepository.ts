// Le segnalazioni del personale su SQLite: una segnalazione fatta alle 8 deve essere ancora lì
// quando l'amministratore arriva alle 9, riavvio o no.
import type { SystemAlert, SystemAlertStatus } from '@/domain/entities/system-alert';
import type { OperatorId, SystemAlertId, WorkstationId } from '@/domain/ids';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import type { SystemAlert as Row } from '@/generated/prisma/client';
import type {
  ISystemAlertRepository,
  SystemAlertFilter,
} from '../interfaces/ISystemAlertRepository';
import type { Db } from './client';

function toEntity(r: Row): SystemAlert {
  return {
    id: r.id as SystemAlertId,
    code: r.code,
    component: r.component as SystemAlert['component'],
    message: r.message,
    status: r.status as SystemAlertStatus,
    reportedByOperatorId: r.reportedByOperatorId as OperatorId,
    reportedByName: r.reportedByName,
    workstationId: r.workstationId as WorkstationId | null,
    workstationName: r.workstationName,
    createdAt: r.createdAt as IsoDateTime,
    updatedAt: r.updatedAt as IsoDateTime,
    handledByOperatorId: r.handledByOperatorId as OperatorId | null,
    handledByName: r.handledByName,
    resolvedAt: r.resolvedAt as IsoDateTime | null,
    adminNote: r.adminNote,
  };
}

function toRow(a: SystemAlert): Row {
  return {
    id: a.id,
    code: a.code,
    component: a.component,
    message: a.message,
    status: a.status,
    reportedByOperatorId: a.reportedByOperatorId,
    reportedByName: a.reportedByName,
    workstationId: a.workstationId,
    workstationName: a.workstationName,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    handledByOperatorId: a.handledByOperatorId,
    handledByName: a.handledByName,
    resolvedAt: a.resolvedAt,
    adminNote: a.adminNote,
  };
}

export class PrismaSystemAlertRepository implements ISystemAlertRepository {
  constructor(private readonly db: Db) {}

  private async salva(alert: SystemAlert): Promise<SystemAlert> {
    const riga = toRow(alert);
    const { id: _id, ...dati } = riga;
    return toEntity(
      await this.db.systemAlert.upsert({ where: { id: alert.id }, create: riga, update: dati }),
    );
  }

  async insert(alert: SystemAlert): Promise<SystemAlert> {
    return this.salva(alert);
  }

  async update(alert: SystemAlert): Promise<SystemAlert> {
    return this.salva(alert);
  }

  async findById(id: SystemAlertId): Promise<SystemAlert | null> {
    const r = await this.db.systemAlert.findUnique({ where: { id } });
    return r === null ? null : toEntity(r);
  }

  async list(filter: SystemAlertFilter): Promise<readonly SystemAlert[]> {
    const rows = await this.db.systemAlert.findMany({
      where: filter.statuses === undefined ? {} : { status: { in: [...filter.statuses] } },
      orderBy: { createdAt: 'desc' },
      take: Math.max(0, filter.limit),
    });
    return rows.map(toEntity);
  }

  async countByStatus(): Promise<Readonly<Record<SystemAlertStatus, number>>> {
    const gruppi = await this.db.systemAlert.groupBy({ by: ['status'], _count: { _all: true } });
    const conteggio: Record<SystemAlertStatus, number> = { NEW: 0, IN_PROGRESS: 0, RESOLVED: 0 };
    for (const g of gruppi) {
      const stato = g.status as SystemAlertStatus;
      if (stato in conteggio) {
        conteggio[stato] = g._count._all;
      }
    }
    return conteggio;
  }
}
