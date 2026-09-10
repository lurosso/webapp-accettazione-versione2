// Forma "wire" dell'agenda Infinity. IPOTESI da confermare con le specifiche reali (M7):
// il mapping verso il dominio è isolato in services/mappers/infinity.mapper.ts.
// I type guard manuali saranno sostituiti da schemi Zod in M0.

/** Cliente come esposto da Infinity. */
export interface InfinityCustomerDto {
  readonly externalId: string | null;
  readonly firstName: string;
  readonly lastName: string;
  /** Numero grezzo, in qualsiasi formato: viene normalizzato dal mapper. */
  readonly phone: string | null;
  readonly email: string | null;
  /** Consenso WhatsApp; null = sconosciuto (trattato come assente). */
  readonly whatsappOptIn: boolean | null;
}

/** Appuntamento come esposto da Infinity. */
export interface InfinityAppointmentDto {
  /** Id stabile dell'appuntamento in Infinity (chiave di upsert). */
  readonly externalId: string;
  /** Orario di prenotazione ISO 8601 (con offset o UTC). */
  readonly scheduledAt: string;
  readonly brandCode: string;
  readonly plate: string;
  readonly vin: string | null;
  readonly vehicleModel: string;
  readonly customer: InfinityCustomerDto;
  readonly serviceDescription: string | null;
  readonly deskCode: string | null;
  readonly cancelled: boolean;
  readonly updatedAt: string;
}

/** Agenda della giornata. `partial` = il DMS ha restituito solo una parte dei dati. */
export interface InfinityAgendaDto {
  readonly businessDate: string;
  readonly fetchedAt: string;
  readonly partial: boolean;
  readonly appointments: readonly InfinityAppointmentDto[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isStringOrNull(v: unknown): v is string | null {
  return v === null || typeof v === 'string';
}

/** Type guard manuale per il cliente (sostituito da Zod in M0). */
export function isInfinityCustomerDto(v: unknown): v is InfinityCustomerDto {
  if (!isRecord(v)) {
    return false;
  }
  return (
    isStringOrNull(v['externalId']) &&
    typeof v['firstName'] === 'string' &&
    typeof v['lastName'] === 'string' &&
    isStringOrNull(v['phone']) &&
    isStringOrNull(v['email']) &&
    (v['whatsappOptIn'] === null || typeof v['whatsappOptIn'] === 'boolean')
  );
}

/** Type guard manuale per l'appuntamento (sostituito da Zod in M0). */
export function isInfinityAppointmentDto(v: unknown): v is InfinityAppointmentDto {
  if (!isRecord(v)) {
    return false;
  }
  return (
    typeof v['externalId'] === 'string' &&
    typeof v['scheduledAt'] === 'string' &&
    typeof v['brandCode'] === 'string' &&
    typeof v['plate'] === 'string' &&
    isStringOrNull(v['vin']) &&
    typeof v['vehicleModel'] === 'string' &&
    isInfinityCustomerDto(v['customer']) &&
    isStringOrNull(v['serviceDescription']) &&
    isStringOrNull(v['deskCode']) &&
    typeof v['cancelled'] === 'boolean' &&
    typeof v['updatedAt'] === 'string'
  );
}

/** Type guard manuale per l'agenda (sostituito da Zod in M0). */
export function isInfinityAgendaDto(v: unknown): v is InfinityAgendaDto {
  if (!isRecord(v)) {
    return false;
  }
  const appointments = v['appointments'];
  return (
    typeof v['businessDate'] === 'string' &&
    typeof v['fetchedAt'] === 'string' &&
    typeof v['partial'] === 'boolean' &&
    Array.isArray(appointments) &&
    appointments.every(isInfinityAppointmentDto)
  );
}
