// Tipi comuni a tutte le porte verso sistemi esterni: opzioni di chiamata,
// errori di provider con flag `retryable`, esiti di invio e health check.

import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import type { Result } from '@/domain/result';

/** Sistemi esterni conosciuti dal progetto. */
export type ProviderName = 'INFINITY' | 'SPOKI' | 'SMS_HOSTING' | 'CRM';

/** Opzioni accettate da ogni chiamata esterna (anche dai mock). */
export interface CallOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly correlationId?: string;
}

/** Codici d'errore normalizzati dei provider. */
export type ProviderErrorCode =
  | 'TIMEOUT'
  | 'NETWORK'
  | 'AUTH'
  | 'RATE_LIMIT'
  | 'INVALID_REQUEST'
  | 'NOT_FOUND'
  | 'PROVIDER_ERROR'
  | 'UNAVAILABLE'
  | 'CIRCUIT_OPEN'
  | 'NOT_IMPLEMENTED'
  | 'UNKNOWN';

/** Errore restituito (mai lanciato) da una porta esterna. `retryable` guida i retry (M3). */
export interface ProviderError {
  readonly provider: ProviderName;
  readonly code: ProviderErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly cause?: unknown;
}

/** Costruisce un ProviderError includendo `cause` solo se fornito. */
export function providerError(
  provider: ProviderName,
  code: ProviderErrorCode,
  message: string,
  retryable: boolean,
  cause?: unknown,
): ProviderError {
  return cause === undefined
    ? { provider, code, message, retryable }
    : { provider, code, message, retryable, cause };
}

/** Result specializzato per le porte esterne. */
export type ProviderResult<T> = Result<T, ProviderError>;

/** Stato di salute di una porta, aggregato da /api/v1/health. */
export interface HealthStatus {
  readonly provider: ProviderName;
  readonly status: 'UP' | 'DEGRADED' | 'DOWN' | 'UNKNOWN';
  readonly checkedAt: IsoDateTime;
  readonly latencyMs: number | null;
  readonly detail: string | null;
  readonly implementation: 'mock' | 'real';
}

/** Ricevuta di accettazione di un messaggio da parte del provider. */
export interface SendReceipt {
  readonly providerMessageId: string;
  readonly acceptedAt: IsoDateTime;
}

/** Stato di consegna di un messaggio. */
export interface DeliveryStatus {
  readonly providerMessageId: string;
  readonly state: 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'UNDELIVERABLE';
  readonly updatedAt: IsoDateTime;
  readonly reason: string | null;
}
