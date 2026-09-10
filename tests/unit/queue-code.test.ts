import { describe, expect, it } from 'vitest';
import {
  compareByScheduleThenSequence,
  formatQueueCode,
  parseQueueCode,
} from '@/domain/value-objects/queue-code';

describe('queue-code', () => {
  it('formatta con tre cifre e zero iniziali', () => {
    expect(formatQueueCode('F', 1)).toBe('F001');
    expect(formatQueueCode('F', 42)).toBe('F042');
    expect(formatQueueCode('J', 999)).toBe('J999');
  });

  it('oltre 999 allarga il padding senza errori', () => {
    expect(formatQueueCode('F', 1000)).toBe('F1000');
  });

  it('valori non validi diventano 000', () => {
    expect(formatQueueCode('F', -5)).toBe('F000');
    expect(formatQueueCode('F', Number.NaN)).toBe('F000');
  });

  it('parseQueueCode è tollerante su maiuscole e spazi', () => {
    expect(parseQueueCode(' f007 ')).toEqual({ prefix: 'F', sequence: 7 });
    expect(parseQueueCode('F1000')).toEqual({ prefix: 'F', sequence: 1000 });
    expect(parseQueueCode('007')).toBeNull();
    expect(parseQueueCode('F')).toBeNull();
  });

  it('ordina per orario e poi per sequenza', () => {
    const rows = [
      { scheduledAt: '2026-09-10T08:00:00.000Z', sequence: 5 },
      { scheduledAt: '2026-09-10T07:30:00.000Z', sequence: 9 },
      { scheduledAt: '2026-09-10T08:00:00.000Z', sequence: 2 },
    ];
    const sorted = [...rows].sort(compareByScheduleThenSequence).map((r) => r.sequence);
    expect(sorted).toEqual([9, 2, 5]);
  });
});
