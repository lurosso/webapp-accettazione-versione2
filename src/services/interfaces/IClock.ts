// Orologio iniettabile: nessun `new Date()` / `Date.now()` diretto fuori dalle implementazioni.

import type { IsoDate, IsoDateTime } from '@/domain/value-objects/iso-date';

/** Sorgente del tempo. SystemClock in produzione, FixedClock nei test e nelle demo. */
export interface IClock {
  /** Istante corrente. */
  now(): Date;
  /** Istante corrente in ISO 8601 UTC. */
  nowIso(): IsoDateTime;
  /** Giornata operativa corrente (Europe/Rome). */
  today(): IsoDate;
}
