// Eventi di dominio: audit trail ("chi ha preso in carico") e base per SSE (M6)
// con resume tramite `seq` monotono.

import type { AppointmentStatus, AppointmentSource } from './entities/appointment';
import type { CrmOutboxStatus } from './entities/crm-outbox-event';
import type { NotificationJobStatus } from './entities/notification';
import type { SyncRunStatus } from './entities/sync-run';
import type { AppointmentId, BayId, CrmOutboxEventId, NotificationJobId, SyncRunId } from './ids';
import type { IsoDateTime } from './value-objects/iso-date';
import type { QueueCode } from './value-objects/queue-code';

/** Tipi di evento pubblicati sull'IEventBus. */
export type DomainEventType =
  | 'APPOINTMENT_CREATED'
  | 'APPOINTMENT_STATUS_CHANGED'
  | 'APPOINTMENT_CODE_ASSIGNED'
  | 'SYNC_RUN_FINISHED'
  | 'NOTIFICATION_JOB_CHANGED'
  | 'CRM_EVENT_CHANGED';

/** Chi ha causato l'evento. */
export interface DomainEventActor {
  readonly kind: 'OPERATOR' | 'SYSTEM' | 'CUSTOMER';
  readonly id: string | null;
}

/** Campi comuni a tutti gli eventi. `seq` è assegnato dal bus alla pubblicazione. */
export interface DomainEventBase {
  readonly seq: number;
  readonly id: string;
  readonly occurredAt: IsoDateTime;
  readonly correlationId: string;
  readonly actor: DomainEventActor;
}

/** Payload specifici per tipo (unione discriminata su `type`). */
export type DomainEventPayload =
  | {
      readonly type: 'APPOINTMENT_STATUS_CHANGED';
      readonly appointmentId: AppointmentId;
      readonly from: AppointmentStatus;
      readonly to: AppointmentStatus;
      readonly bayId: BayId | null;
    }
  | {
      readonly type: 'APPOINTMENT_CREATED';
      readonly appointmentId: AppointmentId;
      readonly source: AppointmentSource;
    }
  | {
      readonly type: 'APPOINTMENT_CODE_ASSIGNED';
      readonly appointmentId: AppointmentId;
      readonly code: QueueCode;
    }
  | {
      readonly type: 'SYNC_RUN_FINISHED';
      readonly syncRunId: SyncRunId;
      readonly status: SyncRunStatus;
    }
  | {
      readonly type: 'NOTIFICATION_JOB_CHANGED';
      readonly jobId: NotificationJobId;
      readonly status: NotificationJobStatus;
    }
  | {
      readonly type: 'CRM_EVENT_CHANGED';
      readonly eventId: CrmOutboxEventId;
      readonly status: CrmOutboxStatus;
    };

/** Evento di dominio completo, come restituito dal bus. */
export type DomainEvent = DomainEventBase & DomainEventPayload;

/** Evento da pubblicare: il bus assegna `seq`. */
export type NewDomainEvent = Omit<DomainEventBase, 'seq'> & DomainEventPayload;
