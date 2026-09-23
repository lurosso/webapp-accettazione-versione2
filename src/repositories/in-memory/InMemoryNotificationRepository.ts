// Outbox delle notifiche in memoria.

import type { NotificationJob, NotificationJobStatus } from '@/domain/entities/notification';
import type { AppointmentId, NotificationJobId } from '@/domain/ids';
import type { IsoDate, IsoDateTime } from '@/domain/value-objects/iso-date';
import type { INotificationRepository } from '../interfaces/INotificationRepository';
import type { InMemoryStore } from './InMemoryStore';

function clone(job: NotificationJob): NotificationJob {
  return { ...job, attempts: job.attempts.map((a) => ({ ...a })) };
}

/** Job di notifica in memoria. */
export class InMemoryNotificationRepository implements INotificationRepository {
  constructor(private readonly store: InMemoryStore) {}

  private get map(): Map<string, NotificationJob> {
    return this.store.state.notificationJobs;
  }

  async insertJob(job: NotificationJob): Promise<NotificationJob> {
    const stored = clone(job);
    this.map.set(stored.id, stored);
    return clone(stored);
  }

  /** Upsert per `id` (vedi INotificationRepository). */
  async updateJob(job: NotificationJob): Promise<NotificationJob> {
    const stored = clone(job);
    this.map.set(stored.id, stored);
    return clone(stored);
  }

  async findJobById(id: NotificationJobId): Promise<NotificationJob | null> {
    const found = this.map.get(id);
    return found === undefined ? null : clone(found);
  }

  async findJobByIdempotencyKey(key: string): Promise<NotificationJob | null> {
    for (const job of this.map.values()) {
      if (job.idempotencyKey === key) {
        return clone(job);
      }
    }
    return null;
  }

  async findJobByProviderMessageId(providerMessageId: string): Promise<NotificationJob | null> {
    for (const job of this.map.values()) {
      if (job.attempts.some((a) => a.providerMessageId === providerMessageId)) {
        return clone(job);
      }
    }
    return null;
  }

  async listByAppointment(appointmentId: AppointmentId): Promise<readonly NotificationJob[]> {
    return [...this.map.values()]
      .filter((j) => j.appointmentId === appointmentId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
      .map(clone);
  }

  async listByDate(businessDate: IsoDate): Promise<readonly NotificationJob[]> {
    return [...this.map.values()]
      .filter((j) => j.businessDate === businessDate)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
      .map(clone);
  }

  async listRetryDue(now: IsoDateTime, limit: number): Promise<readonly NotificationJob[]> {
    return [...this.map.values()]
      .filter((j) => j.status === 'FAILED' && j.nextAttemptAt !== null && j.nextAttemptAt <= now)
      .sort((a, b) => ((a.nextAttemptAt ?? '') < (b.nextAttemptAt ?? '') ? -1 : 1))
      .slice(0, Math.max(0, limit))
      .map(clone);
  }

  async listByStatus(
    statuses: readonly NotificationJobStatus[],
    businessDate?: IsoDate,
  ): Promise<readonly NotificationJob[]> {
    return [...this.map.values()]
      .filter(
        (j) =>
          statuses.includes(j.status) &&
          (businessDate === undefined || j.businessDate === businessDate),
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
      .map(clone);
  }
}
