// Generatore di identificativi iniettabile: UUID in produzione, sequenziale nei test.

/** Genera id univoci; `nextAs` li brandizza direttamente (es. `ids.nextAs(asAppointmentId)`). */
export interface IIdGenerator {
  /** Nuovo id grezzo. */
  next(): string;
  /** Nuovo id già convertito nel tipo brandizzato richiesto. */
  nextAs<T extends string>(brand: (v: string) => T): T;
}
