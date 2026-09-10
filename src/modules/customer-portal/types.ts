// Contratto dati fra l'API pubblica (`/api/v1/public/status`) e il portale cliente.
import type { QueuePositionView } from '@/domain/read-models';

/** Risposta dell'endpoint pubblico di stato. */
export interface PublicStatus {
  readonly position: QueuePositionView;
  readonly serverTime: string;
  readonly timeZone: string;
}

/** Esito della ricerca mostrato dalla UI: successo o motivo leggibile del fallimento. */
export type PublicStatusProblem = 'not-found' | 'invalid-plate' | 'rate-limited' | 'unavailable';
