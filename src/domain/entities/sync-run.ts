// Esecuzione di sincronizzazione dell'agenda Infinity (06:00, manuale, bootstrap).
// L'ultima SyncRun alimenta il SyncBanner della dashboard.

import type { OperatorId, SyncRunId } from '../ids';
import type { IsoDate, IsoDateTime } from '../value-objects/iso-date';

/** Cosa ha avviato la sincronizzazione. */
export type SyncTrigger = 'SCHEDULED' | 'MANUAL' | 'BOOTSTRAP' | 'RETRY';

/** Esito: PARTIAL = agenda parziale (banner giallo), FAILED = banner rosso con fallback manuale. */
export type SyncRunStatus = 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED';

/** Contatori della reconciliation. */
export interface SyncCounters {
  readonly fetched: number;
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly cancelled: number;
  readonly rejected: number;
}

/** Storico di una sincronizzazione. */
export interface SyncRun {
  readonly id: SyncRunId;
  readonly businessDate: IsoDate;
  readonly trigger: SyncTrigger;
  readonly status: SyncRunStatus;
  readonly startedAt: IsoDateTime;
  readonly finishedAt: IsoDateTime | null;
  readonly counters: SyncCounters;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly correlationId: string;
  readonly triggeredByOperatorId: OperatorId | null;
}

/** Contatori azzerati per una nuova SyncRun. */
export const EMPTY_SYNC_COUNTERS: SyncCounters = {
  fetched: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  cancelled: 0,
  rejected: 0,
};
