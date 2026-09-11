// Contratto dati fra l'API pubblica (`/api/v1/public/display`) e i monitor delle campate.
import type { BayDisplayView } from '@/domain/read-models';

/** Risposta dell'endpoint pubblico del display. */
export interface DisplayStatus {
  readonly display: BayDisplayView;
  readonly serverTime: string;
  readonly timeZone: string;
}
