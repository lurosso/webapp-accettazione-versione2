// Postazione: PC fisico dell'accettatore, scelto al login (Vista Multi-Postazione).

import type { BayId, DeskId, WorkstationId } from '../ids';

/** Postazione fisica; determina il filtro predefinito e la campata proposta alla presa in carico. */
export interface Workstation {
  readonly id: WorkstationId;
  /** Codice breve, es. "P1". */
  readonly code: string;
  readonly name: string;
  /** Sportello a cui la postazione appartiene. */
  readonly deskId: DeskId;
  /** Campata proposta di default al "Prendi in carico" (null = scelta ogni volta). */
  readonly defaultBayId: BayId | null;
}
