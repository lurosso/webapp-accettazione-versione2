import { describe, expect, it } from 'vitest';
import { SeededRandom, seedFrom } from '@/services/mocks/data/seeded-random';

describe('seeded-random', () => {
  it('stesso seed → stessa sequenza', () => {
    const a = new SeededRandom(1234);
    const b = new SeededRandom(1234);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).toEqual(seqB);
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it('seed diversi → sequenze diverse', () => {
    const a = new SeededRandom(1);
    const b = new SeededRandom(2);
    expect(a.next()).not.toBe(b.next());
  });

  it('int rispetta gli estremi e seedFrom è deterministico', () => {
    const rng = new SeededRandom(seedFrom('officina', '2026-09-10'));
    for (let i = 0; i < 100; i += 1) {
      const v = rng.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
    }
    expect(seedFrom('a', 'b')).toBe(seedFrom('a', 'b'));
    expect(seedFrom('a', 'b')).not.toBe(seedFrom('b', 'a'));
  });
});
