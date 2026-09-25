// Persistenza delle occupazioni delle accettazioni (una per postazione, una per operatore).

import type { WorkstationClaim } from '@/domain/entities/workstation-claim';
import type { OperatorId, WorkstationId } from '@/domain/ids';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';

export interface IWorkstationClaimRepository {
  findByWorkstation(workstationId: WorkstationId): Promise<WorkstationClaim | null>;
  /**
   * Postazioni occupate e non ancora scadute all'istante indicato. Le sessioni senza sportello
   * (amministratore, kiosk: `sessionOnlyClaimKey`) non occupano niente e qui non compaiono; si
   * leggono con `findByWorkstation` sulla loro chiave.
   */
  listActive(now: IsoDateTime): Promise<readonly WorkstationClaim[]>;
  /** Inserisce o sostituisce l'occupazione della postazione indicata dal claim. */
  upsert(claim: WorkstationClaim): Promise<WorkstationClaim>;
  /** Libera tutte le postazioni occupate dall'operatore (un operatore siede in un posto solo). */
  deleteByOperator(operatorId: OperatorId): Promise<void>;
  deleteByWorkstation(workstationId: WorkstationId): Promise<void>;
}
