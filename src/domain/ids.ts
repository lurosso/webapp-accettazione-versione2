// Identificativi "branded": stringhe tipizzate che impediscono di passare
// per errore l'id di una pratica dove serve l'id di un operatore.

/**
 * Tipo brandizzato generico: `T` arricchito con un marcatore fantasma `B`.
 * Si chiama `Branded` (non `Brand`) per non collidere con l'entità `Brand` (marchio).
 */
export type Branded<T, B extends string> = T & { readonly __brand: B };

export type AppointmentId = Branded<string, 'AppointmentId'>;
export type CustomerId = Branded<string, 'CustomerId'>;
export type VehicleId = Branded<string, 'VehicleId'>;
export type BrandId = Branded<string, 'BrandId'>;
export type DeskId = Branded<string, 'DeskId'>;
export type WorkstationId = Branded<string, 'WorkstationId'>;
export type BayId = Branded<string, 'BayId'>;
export type OperatorId = Branded<string, 'OperatorId'>;
export type NotificationJobId = Branded<string, 'NotificationJobId'>;
export type NotificationAttemptId = Branded<string, 'NotificationAttemptId'>;
export type MediaAssetId = Branded<string, 'MediaAssetId'>;
export type SyncRunId = Branded<string, 'SyncRunId'>;
export type CrmOutboxEventId = Branded<string, 'CrmOutboxEventId'>;

/** Converte una stringa grezza in `AppointmentId` (nessuna validazione: è un cast esplicito). */
export const asAppointmentId = (v: string): AppointmentId => v as AppointmentId;
/** Converte una stringa grezza in `CustomerId`. */
export const asCustomerId = (v: string): CustomerId => v as CustomerId;
/** Converte una stringa grezza in `VehicleId`. */
export const asVehicleId = (v: string): VehicleId => v as VehicleId;
/** Converte una stringa grezza in `BrandId`. */
export const asBrandId = (v: string): BrandId => v as BrandId;
/** Converte una stringa grezza in `DeskId`. */
export const asDeskId = (v: string): DeskId => v as DeskId;
/** Converte una stringa grezza in `WorkstationId`. */
export const asWorkstationId = (v: string): WorkstationId => v as WorkstationId;
/** Converte una stringa grezza in `BayId`. */
export const asBayId = (v: string): BayId => v as BayId;
/** Converte una stringa grezza in `OperatorId`. */
export const asOperatorId = (v: string): OperatorId => v as OperatorId;
/** Converte una stringa grezza in `NotificationJobId`. */
export const asNotificationJobId = (v: string): NotificationJobId => v as NotificationJobId;
/** Converte una stringa grezza in `NotificationAttemptId`. */
export const asNotificationAttemptId = (v: string): NotificationAttemptId =>
  v as NotificationAttemptId;
/** Converte una stringa grezza in `MediaAssetId`. */
export const asMediaAssetId = (v: string): MediaAssetId => v as MediaAssetId;
/** Converte una stringa grezza in `SyncRunId`. */
export const asSyncRunId = (v: string): SyncRunId => v as SyncRunId;
/** Converte una stringa grezza in `CrmOutboxEventId`. */
export const asCrmOutboxEventId = (v: string): CrmOutboxEventId => v as CrmOutboxEventId;
