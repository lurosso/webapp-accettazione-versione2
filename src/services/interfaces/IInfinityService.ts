// Porta verso il DMS Infinity: agenda giornaliera degli appuntamenti.
// Restituisce DTO (forma wire); il mapping verso il dominio vive in services/mappers.

import type { IsoDate } from '@/domain/value-objects/iso-date';
import type { InfinityAgendaDto, InfinityAppointmentDto } from '../dto/infinity.dto';
import type { CallOptions, HealthStatus, ProviderResult } from './common';

/** Accesso in sola lettura all'agenda Infinity. */
export interface IInfinityService {
  readonly name: 'INFINITY';
  /** Agenda completa della giornata operativa (sync delle 06:00 e re-sync). */
  fetchDailyAgenda(
    businessDate: IsoDate,
    options?: CallOptions,
  ): Promise<ProviderResult<InfinityAgendaDto>>;
  /** Ricerca puntuale per targa (fallback quando la pratica non è in coda). */
  fetchAppointmentByPlate(
    plate: string,
    businessDate: IsoDate,
    options?: CallOptions,
  ): Promise<ProviderResult<InfinityAppointmentDto | null>>;
  /** Stato di salute della connessione. */
  healthCheck(options?: CallOptions): Promise<HealthStatus>;
}
