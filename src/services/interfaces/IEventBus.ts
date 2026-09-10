// Bus eventi in-process: audit trail e base per SSE (M6) con resume via `seq`.

import type { DomainEvent, NewDomainEvent } from '@/domain/events';

/** Pubblicazione e sottoscrizione degli eventi di dominio. */
export interface IEventBus {
  /** Assegna `seq` monotono, memorizza e notifica i sottoscrittori; restituisce l'evento completo. */
  publish(event: NewDomainEvent): DomainEvent;
  /** Registra un handler; la funzione restituita lo rimuove. */
  subscribe(handler: (e: DomainEvent) => void): () => void;
  /** Eventi con `seq` maggiore di quello indicato (resume dei client SSE). */
  listSince(seq: number, limit?: number): readonly DomainEvent[];
}
