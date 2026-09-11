// Contratto dati fra le API pubbliche dei monitor (`/api/v1/public/display`, `/api/v1/public/board`)
// e le schermate in officina.
import type { BayDisplayView, WaitingBoardView } from '@/domain/read-models';

/** Risposta dell'endpoint pubblico del monitor di campata. */
export interface DisplayStatus {
  readonly display: BayDisplayView;
  readonly serverTime: string;
  readonly timeZone: string;
}

/** Risposta dell'endpoint pubblico del tabellone di sala d'attesa. */
export interface BoardStatus {
  readonly board: WaitingBoardView;
  readonly serverTime: string;
  readonly timeZone: string;
}
