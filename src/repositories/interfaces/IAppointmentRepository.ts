// Persistenza delle pratiche: interfaccia identica per in-memory (oggi) e Prisma (domani).

import type { Appointment, AppointmentStatus } from '@/domain/entities/appointment';
import type { DomainError } from '@/domain/errors';
import type { AppointmentId, BrandId, DeskId } from '@/domain/ids';
import type { Result } from '@/domain/result';
import type { IsoDate } from '@/domain/value-objects/iso-date';
import type { PlateNumber } from '@/domain/value-objects/plate';
import type { QueueCode } from '@/domain/value-objects/queue-code';

/** Filtri della lista giornaliera. */
export interface AppointmentFilter {
  readonly brandIds?: readonly BrandId[];
  readonly deskIds?: readonly DeskId[];
  readonly statuses?: readonly AppointmentStatus[];
  /** Le CANCELLED sono escluse per default (salvo `statuses` che le include). */
  readonly includeCancelled?: boolean;
}

/** Riepilogo di una reconciliation (usato dal SyncService in M1). */
export interface UpsertSummary {
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly cancelled: number;
}

/** Ambito del conteggio "clienti prima di te". */
export type AheadScope = 'DESK' | 'SITE';

/** Repository delle pratiche. Restituisce sempre copie immutabili. */
export interface IAppointmentRepository {
  findById(id: AppointmentId): Promise<Appointment | null>;
  findByExternalRef(externalRef: string, businessDate: IsoDate): Promise<Appointment | null>;
  findByCode(code: QueueCode, businessDate: IsoDate): Promise<Appointment | null>;
  findByPlate(plate: PlateNumber, businessDate: IsoDate): Promise<readonly Appointment[]>;
  /**
   * Pratiche della giornata ordinate per (scheduledAt, sequence). Le CANCELLED sono escluse
   * salvo `includeCancelled` oppure `statuses` che le richiede esplicitamente (`statuses` è autoritativo).
   */
  listByDate(businessDate: IsoDate, filter?: AppointmentFilter): Promise<readonly Appointment[]>;
  /**
   * Inserimento di una pratica nuova. Un duplicato di `id`, di `(businessDate, code)` o di
   * `(businessDate, externalRef)` → VALIDATION: nessuna sovrascrittura silenziosa.
   */
  insert(appointment: Appointment): Promise<Result<Appointment, DomainError>>;
  /**
   * Aggiornamento con concorrenza ottimistica: se `expectedVersion` non coincide con la
   * versione corrente → VERSION_CONFLICT (409). In caso di successo incrementa `version`
   * e aggiorna `updatedAt`.
   */
  update(appointment: Appointment, expectedVersion: number): Promise<Result<Appointment, DomainError>>;
  /** Contatore atomico per (giornata, prefisso): il numero restituito non viene mai riutilizzato. */
  reserveNextSequence(businessDate: IsoDate, prefix: string): Promise<number>;
  /** Pratiche WAITING/SKIPPED con (scheduledAt, sequence) precedente, nell'ambito indicato. */
  countAhead(appointment: Appointment, scope: AheadScope): Promise<number>;
  /** Svuota le pratiche (solo test); senza argomento svuota tutto. */
  clear(businessDate?: IsoDate): Promise<void>;
}
