// I promemoria e gli avvisi al cliente su SQLite, con i loro tentativi. La chiave di idempotenza
// è un vincolo unico del database: lo stesso promemoria non parte due volte nemmeno se due
// processi lo chiedono nello stesso istante.
import type { NotificationAttempt, NotificationJob } from '@/domain/entities/notification';
import type { AppointmentId, NotificationJobId, OperatorId } from '@/domain/ids';
import type { IsoDate, IsoDateTime } from '@/domain/value-objects/iso-date';
import type { QueueCode } from '@/domain/value-objects/queue-code';
import type { NotificationJob as Row } from '@/generated/prisma/client';
import type { INotificationRepository } from '../interfaces/INotificationRepository';
import type { Db } from './client';
import { fromJson, toJson } from './json';

function toEntity(r: Row): NotificationJob {
  return {
    id: r.id as NotificationJobId,
    appointmentId: r.appointmentId as AppointmentId,
    businessDate: r.businessDate as IsoDate,
    kind: r.kind as NotificationJob['kind'],
    idempotencyKey: r.idempotencyKey,
    recipientPhone: r.recipientPhone as NotificationJob['recipientPhone'],
    whatsappOptIn: r.whatsappOptIn,
    code: r.code as QueueCode,
    templateVariables: fromJson<Record<string, string>>(
      r.templateVariablesJson,
      'templateVariablesJson',
    ),
    renderedText: r.renderedText,
    status: r.status as NotificationJob['status'],
    currentChannel: r.currentChannel as NotificationJob['currentChannel'],
    attempts: fromJson<NotificationAttempt[]>(r.attemptsJson, 'attemptsJson'),
    manualConfirmedBy: r.manualConfirmedBy as OperatorId | null,
    manualNote: r.manualNote,
    createdAt: r.createdAt as IsoDateTime,
    updatedAt: r.updatedAt as IsoDateTime,
  };
}

function toRow(j: NotificationJob): Row {
  return {
    id: j.id,
    appointmentId: j.appointmentId,
    businessDate: j.businessDate,
    kind: j.kind,
    idempotencyKey: j.idempotencyKey,
    recipientPhone: j.recipientPhone,
    whatsappOptIn: j.whatsappOptIn,
    code: j.code,
    templateVariablesJson: toJson(j.templateVariables),
    renderedText: j.renderedText,
    status: j.status,
    currentChannel: j.currentChannel,
    attemptsJson: toJson(j.attempts),
    manualConfirmedBy: j.manualConfirmedBy,
    manualNote: j.manualNote,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
  };
}

export class PrismaNotificationRepository implements INotificationRepository {
  constructor(private readonly db: Db) {}

  private async salva(job: NotificationJob): Promise<NotificationJob> {
    const riga = toRow(job);
    const { id: _id, ...dati } = riga;
    return toEntity(
      await this.db.notificationJob.upsert({ where: { id: job.id }, create: riga, update: dati }),
    );
  }

  async insertJob(job: NotificationJob): Promise<NotificationJob> {
    return this.salva(job);
  }

  async updateJob(job: NotificationJob): Promise<NotificationJob> {
    return this.salva(job);
  }

  async findJobById(id: NotificationJobId): Promise<NotificationJob | null> {
    const r = await this.db.notificationJob.findUnique({ where: { id } });
    return r === null ? null : toEntity(r);
  }

  async findJobByIdempotencyKey(key: string): Promise<NotificationJob | null> {
    const r = await this.db.notificationJob.findUnique({ where: { idempotencyKey: key } });
    return r === null ? null : toEntity(r);
  }

  async findJobByProviderMessageId(providerMessageId: string): Promise<NotificationJob | null> {
    // I tentativi stanno in una colonna JSON: si restringe con `contains` sul testo serializzato
    // (`"providerMessageId":"<id>"`, senza spazi perché `toJson` non li mette) e si conferma in
    // memoria, così un id che compare in un altro campo non viene preso per buono.
    const candidati = await this.db.notificationJob.findMany({
      where: {
        attemptsJson: { contains: `"providerMessageId":${JSON.stringify(providerMessageId)}` },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    const trovato = candidati
      .map(toEntity)
      .find((j) => j.attempts.some((a) => a.providerMessageId === providerMessageId));
    return trovato ?? null;
  }

  async listByAppointment(appointmentId: AppointmentId): Promise<readonly NotificationJob[]> {
    const rows = await this.db.notificationJob.findMany({
      where: { appointmentId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toEntity);
  }

  async listByDate(businessDate: IsoDate): Promise<readonly NotificationJob[]> {
    const rows = await this.db.notificationJob.findMany({
      where: { businessDate },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toEntity);
  }

  async listByStatus(
    statuses: readonly NotificationJob['status'][],
    businessDate?: IsoDate,
  ): Promise<readonly NotificationJob[]> {
    const rows = await this.db.notificationJob.findMany({
      where: {
        status: { in: [...statuses] },
        ...(businessDate === undefined ? {} : { businessDate }),
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toEntity);
  }
}
