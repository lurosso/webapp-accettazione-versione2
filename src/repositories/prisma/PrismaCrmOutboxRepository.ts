// La coda di uscita verso il CRM su SQLite. Un evento «assente» che il CRM non ha ancora ricevuto
// non deve sparire perché il server è stato riavviato: è il motivo per cui esiste una coda.
import type { CrmOutboxEvent } from '@/domain/entities/crm-outbox-event';
import type { AppointmentId, CrmOutboxEventId, OperatorId } from '@/domain/ids';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import type { CrmOutboxEvent as Row } from '@/generated/prisma/client';
import type { ICrmOutboxRepository } from '../interfaces/ICrmOutboxRepository';
import type { Db } from './client';
import { fromJson, toJson } from './json';

function toEntity(r: Row): CrmOutboxEvent {
  return {
    id: r.id as CrmOutboxEventId,
    type: r.type as CrmOutboxEvent['type'],
    anomalyKind: r.anomalyKind as CrmOutboxEvent['anomalyKind'],
    appointmentId: r.appointmentId as AppointmentId,
    idempotencyKey: r.idempotencyKey,
    payload: fromJson<Record<string, unknown>>(r.payloadJson, 'payloadJson'),
    operatorNote: r.operatorNote,
    status: r.status as CrmOutboxEvent['status'],
    attemptCount: r.attemptCount,
    nextAttemptAt: r.nextAttemptAt as IsoDateTime | null,
    lastError: r.lastError,
    crmAckId: r.crmAckId,
    createdAt: r.createdAt as IsoDateTime,
    sentAt: r.sentAt as IsoDateTime | null,
    handledAt: r.handledAt as IsoDateTime | null,
    handledByOperatorId: r.handledByOperatorId as OperatorId | null,
    handledNote: r.handledNote,
  };
}

function toRow(e: CrmOutboxEvent): Row {
  return {
    id: e.id,
    type: e.type,
    anomalyKind: e.anomalyKind,
    appointmentId: e.appointmentId,
    idempotencyKey: e.idempotencyKey,
    payloadJson: toJson(e.payload),
    operatorNote: e.operatorNote,
    status: e.status,
    attemptCount: e.attemptCount,
    nextAttemptAt: e.nextAttemptAt,
    lastError: e.lastError,
    crmAckId: e.crmAckId,
    createdAt: e.createdAt,
    sentAt: e.sentAt,
    handledAt: e.handledAt,
    handledByOperatorId: e.handledByOperatorId,
    handledNote: e.handledNote,
  };
}

export class PrismaCrmOutboxRepository implements ICrmOutboxRepository {
  constructor(private readonly db: Db) {}

  private async salva(event: CrmOutboxEvent): Promise<CrmOutboxEvent> {
    const riga = toRow(event);
    const { id: _id, ...dati } = riga;
    return toEntity(
      await this.db.crmOutboxEvent.upsert({ where: { id: event.id }, create: riga, update: dati }),
    );
  }

  async insert(event: CrmOutboxEvent): Promise<CrmOutboxEvent> {
    return this.salva(event);
  }

  async update(event: CrmOutboxEvent): Promise<CrmOutboxEvent> {
    return this.salva(event);
  }

  async findById(id: CrmOutboxEventId): Promise<CrmOutboxEvent | null> {
    const r = await this.db.crmOutboxEvent.findUnique({ where: { id } });
    return r === null ? null : toEntity(r);
  }

  async findByIdempotencyKey(key: string): Promise<CrmOutboxEvent | null> {
    const r = await this.db.crmOutboxEvent.findUnique({ where: { idempotencyKey: key } });
    return r === null ? null : toEntity(r);
  }

  async listDue(now: IsoDateTime, limit: number): Promise<readonly CrmOutboxEvent[]> {
    const rows = await this.db.crmOutboxEvent.findMany({
      where: {
        status: { in: ['PENDING', 'FAILED'] },
        nextAttemptAt: { not: null, lte: now },
      },
      orderBy: { createdAt: 'asc' },
      take: Math.max(0, limit),
    });
    return rows.map(toEntity);
  }

  async listByStatus(
    statuses: readonly CrmOutboxEvent['status'][],
  ): Promise<readonly CrmOutboxEvent[]> {
    const rows = await this.db.crmOutboxEvent.findMany({
      where: { status: { in: [...statuses] } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toEntity);
  }
}
