// Mapping puro dal dominio ai payload dei webhook CRM (modulo F).

import type { Appointment } from '@/domain/entities/appointment';
import type { Brand } from '@/domain/entities/brand';
import type { CrmAnomalyKind, CrmOutboxEvent } from '@/domain/entities/crm-outbox-event';
import { customerFullName } from '@/domain/entities/customer';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import type {
  CrmAnomalyPayloadDto,
  CrmCheckInPayloadDto,
  CrmNoShowPayloadDto,
  CrmNoShowReason,
} from '../dto/crm.dto';

/** Descrizioni in italiano delle anomalie per il BDC. */
const ANOMALY_DESCRIPTIONS: Readonly<Record<CrmAnomalyKind, string>> = {
  EXCESSIVE_SKIPS: 'La pratica è stata saltata un numero eccessivo di volte.',
  LONG_WAIT: 'Il cliente ha atteso oltre la soglia configurata.',
  NOTIFICATION_FAILED: 'Il promemoria non è stato consegnato su nessun canale.',
  MANUAL_APPOINTMENT: "Pratica inserita manualmente perché assente dall'agenda Infinity.",
};

/** Chiave di idempotenza del no-show: una sola segnalazione per pratica e giornata. */
export function buildNoShowIdempotencyKey(appointment: Appointment): string {
  return `${appointment.id}:NO_SHOW:${appointment.businessDate}`;
}

/** Costruisce il payload di no-show a partire dalla pratica. */
export function toCrmNoShowPayload(
  appointment: Appointment,
  brand: Brand,
  detectedAt: IsoDateTime,
  reason: CrmNoShowReason,
): CrmNoShowPayloadDto {
  return {
    schemaVersion: 1,
    idempotencyKey: buildNoShowIdempotencyKey(appointment),
    appointmentExternalRef: appointment.externalRef,
    code: appointment.code,
    businessDate: appointment.businessDate,
    scheduledAt: appointment.scheduledAt,
    customer: {
      fullName: customerFullName(appointment.customer),
      phone: appointment.customer.phone,
    },
    vehicle: {
      plate: appointment.vehicle.plate,
      brandCode: brand.code,
      model: appointment.vehicle.model,
    },
    detectedAt,
    reason,
  };
}

/**
 * Costruisce il payload di anomalia dall'evento in outbox.
 * Se `anomalyKind` è null (evento malformato) si usa MANUAL_APPOINTMENT come tipo neutro
 * e la descrizione lo segnala: la consegna non deve bloccarsi.
 */
/** Chiave dell'evento di accettazione conclusa: una per pratica e giornata. */
export function buildCheckInIdempotencyKey(appointment: Appointment): string {
  return `${appointment.id}:CHECK_IN:${appointment.businessDate}`;
}

/** Accettazione conclusa al veicolo: note e riferimenti alle foto, mai i binari. */
export function toCrmCheckInPayload(
  appointment: Appointment,
  brand: Brand,
  input: {
    readonly inspectionNotes: string | null;
    readonly photos: readonly { readonly url: string; readonly capturedAt: string }[];
    readonly completedAt: IsoDateTime;
    readonly operatorId: string;
  },
): CrmCheckInPayloadDto {
  return {
    schemaVersion: 1,
    idempotencyKey: buildCheckInIdempotencyKey(appointment),
    appointmentExternalRef: appointment.externalRef,
    code: appointment.code,
    businessDate: appointment.businessDate,
    customer: {
      fullName: customerFullName(appointment.customer),
      phone: appointment.customer.phone,
    },
    vehicle: {
      plate: appointment.vehicle.plate,
      brandCode: brand.code,
      model: appointment.vehicle.model,
    },
    inspectionNotes: input.inspectionNotes,
    photos: input.photos,
    completedAt: input.completedAt,
    operatorId: input.operatorId,
  };
}

export function toCrmAnomalyPayload(
  event: CrmOutboxEvent,
  appointment: Appointment,
): CrmAnomalyPayloadDto {
  const anomalyKind: CrmAnomalyKind = event.anomalyKind ?? 'MANUAL_APPOINTMENT';
  const description =
    event.anomalyKind === null
      ? `Anomalia non classificata (evento ${event.id}).`
      : ANOMALY_DESCRIPTIONS[anomalyKind];
  return {
    schemaVersion: 1,
    idempotencyKey: event.idempotencyKey,
    anomalyKind,
    appointmentExternalRef: appointment.externalRef,
    code: appointment.code,
    description,
    detectedAt: event.createdAt,
    details: { ...event.payload, appointmentId: appointment.id, skipCount: appointment.skipCount },
  };
}
