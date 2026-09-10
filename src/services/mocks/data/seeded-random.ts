// PRNG deterministico (mulberry32): stessa semente → stessa sequenza, così l'agenda
// finta di una giornata è identica a ogni riavvio (idempotenza della sync, test riproducibili).

import { fnv1a32 } from '@/lib/hash';

/** Generatore pseudo-casuale seminato. */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Numero in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Intero in [min, max] (estremi inclusi). */
  int(min: number, max: number): number {
    const lo = Math.ceil(Math.min(min, max));
    const hi = Math.floor(Math.max(min, max));
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  /** Elemento casuale dell'array. Array vuoto = bug di programmazione. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new RangeError('SeededRandom.pick: array vuoto.');
    }
    const item = items[this.int(0, items.length - 1)];
    if (item === undefined) {
      throw new RangeError('SeededRandom.pick: indice fuori intervallo.');
    }
    return item;
  }

  /** Vero con probabilità `p` (0-1). */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Copia mescolata (Fisher-Yates) dell'array. */
  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = this.int(0, i);
      const a = copy[i];
      const b = copy[j];
      if (a !== undefined && b !== undefined) {
        copy[i] = b;
        copy[j] = a;
      }
    }
    return copy;
  }

  /** Stringa di `length` caratteri presi dall'alfabeto indicato. */
  string(alphabet: string, length: number): string {
    let out = '';
    for (let i = 0; i < length; i += 1) {
      out += alphabet.charAt(this.int(0, alphabet.length - 1));
    }
    return out;
  }
}

/** Semente numerica deterministica da più parti testuali (fnv1a32 di `parts.join('|')`). */
export function seedFrom(...parts: string[]): number {
  return fnv1a32(parts.join('|'));
}
