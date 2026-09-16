// Contratto dati fra l'API pubblica (`/api/v1/public/status`, `/api/v1/public/late-notice`) e il
// portale cliente.
import type { PortalStatusView } from '@/domain/read-models';

/** Risposta degli endpoint pubblici: lo stato della pratica visto dal cliente. */
export interface PublicStatus {
  readonly position: PortalStatusView;
  readonly serverTime: string;
  readonly timeZone: string;
}

/** Esito della ricerca mostrato dalla UI: successo o motivo leggibile del fallimento. */
export type PublicStatusProblem = 'not-found' | 'invalid-plate' | 'rate-limited' | 'unavailable';
