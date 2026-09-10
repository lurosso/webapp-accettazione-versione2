// Orologio fisso e manovrabile per test e demo (es. simulare le 06:00 o il cambio giornata).

import type { IsoDate, IsoDateTime } from '@/domain/value-objects/iso-date';
import { isoDateTime } from '@/domain/value-objects/iso-date';
import { toBusinessDate } from '@/lib/dates';
import type { IClock } from '../interfaces/IClock';

/** Orologio deterministico: restituisce sempre l'istante impostato finché non viene mosso. */
export class FixedClock implements IClock {
  private current: Date;

  constructor(
    fixed: Date,
    private readonly timeZone = 'Europe/Rome',
  ) {
    this.current = new Date(fixed.getTime());
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  nowIso(): IsoDateTime {
    return isoDateTime(this.current);
  }

  today(): IsoDate {
    return toBusinessDate(this.current, this.timeZone);
  }

  /** Imposta un nuovo istante. */
  set(d: Date): void {
    this.current = new Date(d.getTime());
  }

  /** Avanza l'orologio di `ms` millisecondi. */
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
