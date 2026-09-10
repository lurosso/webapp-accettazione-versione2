// Generatore di id prevedibili (id-1, id-2, ...) per test e fixture.

import type { IIdGenerator } from '../interfaces/IIdGenerator';

/** Id sequenziali con prefisso configurabile. */
export class SequentialIdGenerator implements IIdGenerator {
  private counter = 0;

  constructor(private readonly prefix = 'id') {}

  next(): string {
    this.counter += 1;
    return `${this.prefix}-${this.counter}`;
  }

  nextAs<T extends string>(brand: (v: string) => T): T {
    return brand(this.next());
  }

  /** Riporta il contatore a zero (fra un test e l'altro). */
  reset(): void {
    this.counter = 0;
  }
}
