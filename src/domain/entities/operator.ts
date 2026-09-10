// Accettatore (operatore) con ruolo e sportelli di competenza.

import type { DeskId, OperatorId, WorkstationId } from '../ids';

/**
 * Ruoli: ADVISOR opera sulla coda; SUPERVISOR forza stati, riapre no-show e
 * conferma i fallback manuali; ADMIN accede alla pagina Sistema e alla sync manuale.
 */
export type OperatorRole = 'ADVISOR' | 'SUPERVISOR' | 'ADMIN';

/** Accettatore. Il ruolo è sempre riverificato lato server, mai fidandosi del solo JWT. */
export interface Operator {
  readonly id: OperatorId;
  readonly username: string;
  readonly displayName: string;
  readonly role: OperatorRole;
  /** Sportelli su cui l'operatore lavora abitualmente. */
  readonly deskIds: readonly DeskId[];
  readonly defaultWorkstationId: WorkstationId | null;
  /** Hash della password (scrypt da M1). Nel seed demo vale "plain:demo": SOLO sviluppo. */
  readonly passwordHash: string;
  readonly isActive: boolean;
}
