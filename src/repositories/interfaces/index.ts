// Barrel delle interfacce dei repository e tipo aggregato `Repositories`.

import type { IAppointmentRepository } from './IAppointmentRepository';
import type { ICrmOutboxRepository } from './ICrmOutboxRepository';
import type { IMediaRepository } from './IMediaRepository';
import type { INotificationRepository } from './INotificationRepository';
import type { IOperatorRepository } from './IOperatorRepository';
import type { IReferenceDataRepository } from './IReferenceDataRepository';
import type { ISyncRunRepository } from './ISyncRunRepository';

export type {
  AheadScope,
  AppointmentFilter,
  IAppointmentRepository,
  UpsertSummary,
} from './IAppointmentRepository';
export type { IOperatorRepository } from './IOperatorRepository';
export type { IReferenceDataRepository } from './IReferenceDataRepository';
export type { INotificationRepository } from './INotificationRepository';
export type { ISyncRunRepository } from './ISyncRunRepository';
export type { ICrmOutboxRepository } from './ICrmOutboxRepository';
export type { IMediaRepository } from './IMediaRepository';

/** Insieme dei repository esposto dal container. */
export interface Repositories {
  readonly appointments: IAppointmentRepository;
  readonly operators: IOperatorRepository;
  readonly referenceData: IReferenceDataRepository;
  readonly notifications: INotificationRepository;
  readonly syncRuns: ISyncRunRepository;
  readonly crmOutbox: ICrmOutboxRepository;
  readonly media: IMediaRepository;
}
