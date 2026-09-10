// Outbox delle notifiche (job + tentativi embedded).

import type { NotificationJob, NotificationJobStatus } from '@/domain/entities/notification';
import type { AppointmentId, NotificationJobId } from '@/domain/ids';
import type { IsoDate } from '@/domain/value-objects/iso-date';

/** Repository dei job di notifica. */
export interface INotificationRepository {
  /** Inserisce un job nuovo (l'orchestratore garantisce l'unicità per `idempotencyKey`). */
  insertJob(job: NotificationJob): Promise<NotificationJob>;
  /**
   * Salva lo stato corrente del job con semantica UPSERT (insert-or-update per `id`):
   * l'orchestratore vi si affida nel percorso `failSafe` per persistere un job che potrebbe
   * non essere mai stato inserito. L'implementazione Prisma userà `upsert`, non `update`.
   */
  updateJob(job: NotificationJob): Promise<NotificationJob>;
  findJobById(id: NotificationJobId): Promise<NotificationJob | null>;
  findJobByIdempotencyKey(key: string): Promise<NotificationJob | null>;
  listByAppointment(appointmentId: AppointmentId): Promise<readonly NotificationJob[]>;
  listByStatus(
    statuses: readonly NotificationJobStatus[],
    businessDate?: IsoDate,
  ): Promise<readonly NotificationJob[]>;
}
