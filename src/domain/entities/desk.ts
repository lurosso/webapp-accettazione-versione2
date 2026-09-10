// Sportello: raggruppamento di brand serviti; filtro nativo della dashboard.

import type { BrandId, DeskId } from '../ids';

/** Sportello dell'accettazione; distinto dalla postazione fisica (Workstation). */
export interface Desk {
  readonly id: DeskId;
  /** Codice breve, es. "S1". */
  readonly code: string;
  readonly name: string;
  /** Marchi serviti da questo sportello. */
  readonly brandIds: readonly BrandId[];
  readonly isActive: boolean;
}
