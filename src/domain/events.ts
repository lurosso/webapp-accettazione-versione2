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
  | 'CUSTOMER_LATE_NOTICE'
  | 'CUSTOMER_ARRIVED'
  | 'SYNC_RUN_FINISHED'
  | 'NOTIFICATION_JOB_CHANGED'
  | 'CRM_EVENT_CHANGED'
  | 'BUSINESS_DAY_CLOSED';

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
      /**
       * Il cliente ha avvisato dal portale che arriva in ritardo: la dashboard mostra l'avviso
       * ambra e il cliente è atteso a `etaAt` prima di finire fra gli assenti. L'ordine della coda
       * non cambia; l'attore è il cliente stesso (`actor.kind = 'CUSTOMER'`).
       */
      readonly type: 'CUSTOMER_LATE_NOTICE';
      readonly appointmentId: AppointmentId;
      readonly minutes: number;
      readonly etaAt: IsoDateTime;
    }
  | {
      /**
       * Il cliente ha risposto «Arrivato» al messaggio WhatsApp (o dal portale): è in fila fuori,
       * in auto, e aspetta il proprio turno. La coda non cambia ordine; l'accettazione sa chi è presente e
       * il cliente riceve codice e link alla pagina di tracciamento.
       */
      readonly type: 'CUSTOMER_ARRIVED';
      readonly appointmentId: AppointmentId;
      readonly code: QueueCode;
      /** Come si è annunciato: la risposta su WhatsApp oppure il portale. */
      readonly channel: 'WHATSAPP' | 'PORTAL';
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
    }
  | {
      /**
       * Giornata chiusa: nessuna pratica resta in coda o in carico. I monitor e il tabellone si
       * svuotano da soli perché le loro viste derivano dalle pratiche aperte, ma l'evento serve
       * a chi ascolta il bus (SSE di M6, futuri riepiloghi) per sapere quando è successo.
       */
      readonly type: 'BUSINESS_DAY_CLOSED';
      readonly businessDate: string;
      readonly noShowCount: number;
      /** Pratiche ancora in carico chiuse d'ufficio (completate, da confermare). */
      readonly autoClosedCount: number;
    };

/** Evento di dominio completo, come restituito dal bus. */
export type DomainEvent = DomainEventBase & DomainEventPayload;

/** Evento da pubblicare: il bus assegna `seq`. */
export type NewDomainEvent = Omit<DomainEventBase, 'seq'> & DomainEventPayload;
