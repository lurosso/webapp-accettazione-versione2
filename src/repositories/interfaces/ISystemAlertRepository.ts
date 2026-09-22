// Segnalazioni di disfunzione al personale amministrativo.

import type { SystemAlert, SystemAlertStatus } from '@/domain/entities/system-alert';
import type { SystemAlertId } from '@/domain/ids';

export interface SystemAlertFilter {
  /** Stati da includere; assente = tutti. */
  readonly statuses?: readonly SystemAlertStatus[];
  /** Quante al massimo, dalla più recente. */
  readonly limit: number;
}

/** Repository delle segnalazioni. */
export interface ISystemAlertRepository {
  insert(alert: SystemAlert): Promise<SystemAlert>;
  update(alert: SystemAlert): Promise<SystemAlert>;
  findById(id: SystemAlertId): Promise<SystemAlert | null>;
  /** Dalla più recente (createdAt decrescente). */
  list(filter: SystemAlertFilter): Promise<readonly SystemAlert[]>;
  /** Quante segnalazioni per stato: alimenta il contatore sulla scheda dell'amministratore. */
  countByStatus(): Promise<Readonly<Record<SystemAlertStatus, number>>>;
}
