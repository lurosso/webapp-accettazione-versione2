// Payload dei webhook verso il CRM/BDC (modulo F). Versionati con `schemaVersion`.

import type { CrmAnomalyKind } from '@/domain/entities/crm-outbox-event';

/** Motivo della segnalazione di no-show. */
export type CrmNoShowReason = 'NOT_ARRIVED' | 'MARKED_BY_OPERATOR';

/** Segnalazione di appuntamento non rispettato. */
export interface CrmNoShowPayloadDto {
  readonly schemaVersion: 1;
  readonly idempotencyKey: string;
  readonly appointmentExternalRef: string | null;
  readonly code: string;
  readonly businessDate: string;
  readonly scheduledAt: string;
  readonly customer: { readonly fullName: string; readonly phone: string | null };
  readonly vehicle: { readonly plate: string; readonly brandCode: string; readonly model: string };
  readonly detectedAt: string;
  readonly reason: CrmNoShowReason;
}

/** Segnalazione di anomalia di flusso. */
export interface CrmAnomalyPayloadDto {
  readonly schemaVersion: 1;
  readonly idempotencyKey: string;
  readonly anomalyKind: CrmAnomalyKind;
  readonly appointmentExternalRef: string | null;
  readonly code: string;
  readonly description: string;
  readonly detectedAt: string;
  readonly details: Readonly<Record<string, unknown>>;
}

/** Ricevuta del CRM. */
/**
 * Accettazione conclusa al veicolo: quello che il BDC deve sapere per il seguito della pratica.
 * Le foto viaggiano come riferimenti (URL), non come binari: il CRM le scarica se gli servono.
 */
export interface CrmCheckInPayloadDto {
  readonly schemaVersion: 1;
  readonly idempotencyKey: string;
  readonly appointmentExternalRef: string | null;
  readonly code: string;
  readonly businessDate: string;
  readonly customer: { readonly fullName: string; readonly phone: string | null };
  readonly vehicle: { readonly plate: string; readonly brandCode: string; readonly model: string };
  /** Note e danni rilevati dall'accettatore durante il giro del veicolo. */
  readonly inspectionNotes: string | null;
  /** Foto del giro veicolo: indirizzo, istante e parte ripresa (FRONT, REAR, LEFT, RIGHT, …). */
  readonly photos: readonly {
    readonly url: string;
    readonly capturedAt: string;
    readonly category: string | null;
  }[];
  readonly completedAt: string;
  readonly operatorId: string;
}

export interface CrmAckDto {
  readonly ackId: string;
  readonly receivedAt: string;
}
