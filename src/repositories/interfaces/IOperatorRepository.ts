// Persistenza degli accettatori (usata da IAuthService in M1).

import type { Operator } from '@/domain/entities/operator';
import type { OperatorId } from '@/domain/ids';

/** Repository degli operatori. */
export interface IOperatorRepository {
  findById(id: OperatorId): Promise<Operator | null>;
  /** Ricerca case-insensitive per username. */
  findByUsername(username: string): Promise<Operator | null>;
  listActive(): Promise<readonly Operator[]>;
}
