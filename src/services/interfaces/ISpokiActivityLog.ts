// Registro delle chiamate verso Spoki (reali o simulate): cosa è stato inviato, a chi, con che
// esito. In modalità simulazione è l'unica traccia dei messaggi; in modalità live è il diario da
// leggere quando un cliente dice "non mi è arrivato niente". Solo interfaccia: l'implementazione
// in memoria vive in `infrastructure/messaging/spoki`.

import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import type { SpokiMode } from './provider-kinds';

export interface SpokiActivityEntry {
  readonly id: string;
  readonly at: IsoDateTime;
  readonly mode: SpokiMode;
  /** Template Spoki chiamato (CONFIRMATION, TURN_APPROACHING, CANCELLATION) o "TEST". */
  readonly templateKind: string;
  /** Chiave del template Meta (es. booking_confirmed_v1). */
  readonly templateKey: string;
  /** URL del webhook chiamato; null quando in simulazione non è configurato. */
  readonly url: string | null;
  /** Numero mascherato: il registro è leggibile dall'amministratore, non deve mostrare tutto. */
  readonly phoneMasked: string;
  /** Payload inviato (o che sarebbe stato inviato), così com'è. */
  readonly payload: Readonly<Record<string, unknown>>;
  readonly outcome: {
    readonly ok: boolean;
    readonly httpStatus: number | null;
    readonly messageId: string | null;
    readonly error: string | null;
  };
  readonly correlationId: string;
}

export interface ISpokiActivityLog {
  record(entry: Omit<SpokiActivityEntry, 'id'>): SpokiActivityEntry;
  /** Voci dalla più recente; `limit` predefinito 100. */
  list(limit?: number): readonly SpokiActivityEntry[];
  clear(): void;
}
