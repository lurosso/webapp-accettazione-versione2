// Occupazione di un'accettazione (postazione) da parte di un operatore collegato.
//
// Al login l'operatore sceglie "Accettazione N": da quel momento quella postazione è sua finché
// non esce o la sessione scade, e agli altri non viene più proposta. Senza questo, due colleghi
// potrebbero scegliere la stessa accettazione e i monitor chiamerebbero due clienti allo stesso
// posto. Il record è volatile per natura (vive quanto una sessione) e non finisce nello snapshot.

import type { OperatorId, WorkstationId } from '../ids';
import type { IsoDateTime } from '../value-objects/iso-date';

export interface WorkstationClaim {
  readonly workstationId: WorkstationId;
  readonly operatorId: OperatorId;
  /** Nome mostrato a chi trova l'accettazione occupata ("in uso da Mario Rossi"). */
  readonly operatorName: string;
  readonly claimedAt: IsoDateTime;
  /** Coincide con la scadenza della sessione: una postazione dimenticata si libera da sola. */
  readonly expiresAt: IsoDateTime;
}

/** True se la prenotazione vale ancora all'istante indicato. */
export function isClaimActive(claim: WorkstationClaim, now: IsoDateTime): boolean {
  return claim.expiresAt > now;
}

/**
 * Prefisso della «sessione senza sportello» (amministratore, kiosk). Chi non siede a un banco non
 * occupa nessuna postazione, ma la sua sessione resta registrata come le altre: vale anche per lui
 * la regola di una sola sessione valida per operatore (l'ultimo accesso). Nessun id di postazione
 * comincia così.
 */
export const SESSION_ONLY_CLAIM_PREFIX = 'sessione:';

/** Chiave della sessione senza sportello di un operatore. */
export function sessionOnlyClaimKey(operatorId: OperatorId): WorkstationId {
  return `${SESSION_ONLY_CLAIM_PREFIX}${operatorId}` as WorkstationId;
}

/** True se il record occupa davvero una postazione (non è una sessione senza sportello). */
export function isWorkstationClaim(claim: Pick<WorkstationClaim, 'workstationId'>): boolean {
  return !claim.workstationId.startsWith(SESSION_ONLY_CLAIM_PREFIX);
}
