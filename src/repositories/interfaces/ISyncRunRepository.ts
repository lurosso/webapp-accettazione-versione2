// Storico delle sincronizzazioni Infinity.

import type { SyncRun } from '@/domain/entities/sync-run';
import type { IsoDate } from '@/domain/value-objects/iso-date';

/** Repository delle SyncRun. */
export interface ISyncRunRepository {
  insert(run: SyncRun): Promise<SyncRun>;
  update(run: SyncRun): Promise<SyncRun>;
  /** Ultima esecuzione (qualunque esito) della giornata. */
  findLatest(businessDate: IsoDate): Promise<SyncRun | null>;
  /** Ultima esecuzione con esito SUCCESS o PARTIAL della giornata. */
  findLastSuccessful(businessDate: IsoDate): Promise<SyncRun | null>;
  /** Esecuzioni più recenti, dalla più nuova. */
  listRecent(limit: number): Promise<readonly SyncRun[]>;
}
