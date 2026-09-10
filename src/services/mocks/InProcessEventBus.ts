// Bus eventi in memoria con log append-only e `seq` monotono: audit trail e
// sorgente per l'SSE di M6 (resume con listSince).

import type { DomainEvent, NewDomainEvent } from '@/domain/events';
import type { IEventBus } from '../interfaces/IEventBus';

/** Bus eventi in-process; conserva al massimo `maxRetained` eventi. */
export class InProcessEventBus implements IEventBus {
  private seq = 0;
  private readonly events: DomainEvent[] = [];
  private readonly handlers = new Set<(e: DomainEvent) => void>();

  constructor(private readonly maxRetained = 5000) {}

  publish(event: NewDomainEvent): DomainEvent {
    this.seq += 1;
    // `NewDomainEvent` è un'intersezione distribuita sull'unione dei payload: aggiungere
    // `seq` produce direttamente un `DomainEvent`, senza cast.
    const full: DomainEvent = { ...event, seq: this.seq };
    this.events.push(full);
    if (this.events.length > this.maxRetained) {
      this.events.splice(0, this.events.length - this.maxRetained);
    }
    for (const handler of this.handlers) {
      try {
        handler(full);
      } catch {
        // Un sottoscrittore difettoso non deve bloccare la pubblicazione.
      }
    }
    return full;
  }

  subscribe(handler: (e: DomainEvent) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  listSince(seq: number, limit = 500): readonly DomainEvent[] {
    const out: DomainEvent[] = [];
    for (const e of this.events) {
      if (e.seq > seq) {
        out.push(e);
        if (out.length >= limit) {
          break;
        }
      }
    }
    return out;
  }

  /** Ultimo `seq` assegnato (0 se nessun evento). */
  get lastSeq(): number {
    return this.seq;
  }
}
