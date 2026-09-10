// Orologio reale: unico punto in cui è ammesso `new Date()` per l'ora corrente.

import type { IsoDate, IsoDateTime } from '@/domain/value-objects/iso-date';
import { isoDateTime } from '@/domain/value-objects/iso-date';
import { toBusinessDate } from '@/lib/dates';
import type { IClock } from '../interfaces/IClock';

/** Orologio di sistema con giornata operativa calcolata nel fuso indicato. */
export class SystemClock implements IClock {
  constructor(private readonly timeZone = 'Europe/Rome') {}

  now(): Date {
    return new Date();
  }

  nowIso(): IsoDateTime {
    return isoDateTime(this.now());
  }

  today(): IsoDate {
    return toBusinessDate(this.now(), this.timeZone);
  }
}
