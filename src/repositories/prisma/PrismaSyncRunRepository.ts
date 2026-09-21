// Le sincronizzazioni con Infinity su SQLite: il banner «sincronizzazione parziale alle 15:41» e
// la decisione «oggi la sync è già partita?» dello scheduler devono sopravvivere al riavvio,
// altrimenti ogni riavvio rilancia la sync.
import type { SyncCounters, SyncRun } from '@/domain/entities/sync-run';
import type { OperatorId, SyncRunId } from '@/domain/ids';
import type { IsoDate, IsoDateTime } from '@/domain/value-objects/iso-date';
import type { SyncRun as Row } from '@/generated/prisma/client';
import type { ISyncRunRepository } from '../interfaces/ISyncRunRepository';
import type { Db } from './client';
import { fromJson, toJson } from './json';

function toEntity(r: Row): SyncRun {
  return {
    id: r.id as SyncRunId,
    businessDate: r.businessDate as IsoDate,
    trigger: r.trigger as SyncRun['trigger'],
    status: r.status as SyncRun['status'],
    startedAt: r.startedAt as IsoDateTime,
    finishedAt: r.finishedAt as IsoDateTime | null,
    counters: fromJson<SyncCounters>(r.countersJson, 'countersJson'),
    errorCode: r.errorCode,
    errorMessage: r.errorMessage,
    correlationId: r.correlationId,
    triggeredByOperatorId: r.triggeredByOperatorId as OperatorId | null,
  };
}

function toRow(s: SyncRun): Row {
  return {
    id: s.id,
    businessDate: s.businessDate,
    trigger: s.trigger,
    status: s.status,
    startedAt: s.startedAt,
    finishedAt: s.finishedAt,
    countersJson: toJson(s.counters),
    errorCode: s.errorCode,
    errorMessage: s.errorMessage,
    correlationId: s.correlationId,
    triggeredByOperatorId: s.triggeredByOperatorId,
  };
}

export class PrismaSyncRunRepository implements ISyncRunRepository {
  constructor(private readonly db: Db) {}

  private async salva(run: SyncRun): Promise<SyncRun> {
    const riga = toRow(run);
    const { id: _id, ...dati } = riga;
    return toEntity(await this.db.syncRun.upsert({ where: { id: run.id }, create: riga, update: dati }));
  }

  async insert(run: SyncRun): Promise<SyncRun> {
    return this.salva(run);
  }

  async update(run: SyncRun): Promise<SyncRun> {
    return this.salva(run);
  }

  async findLatest(businessDate: IsoDate): Promise<SyncRun | null> {
    const r = await this.db.syncRun.findFirst({
      where: { businessDate },
      orderBy: { startedAt: 'desc' },
    });
    return r === null ? null : toEntity(r);
  }

  async findLastSuccessful(businessDate: IsoDate): Promise<SyncRun | null> {
    const r = await this.db.syncRun.findFirst({
      where: { businessDate, status: { in: ['SUCCESS', 'PARTIAL'] } },
      orderBy: { startedAt: 'desc' },
    });
    return r === null ? null : toEntity(r);
  }

  async listRecent(limit: number): Promise<readonly SyncRun[]> {
    const rows = await this.db.syncRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: Math.max(0, limit),
    });
    return rows.map(toEntity);
  }
}
