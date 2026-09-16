// Persistenza delle pratiche: interfaccia identica per in-memory (oggi) e Prisma (domani).

import type {
  Appointment,
  AppointmentFlow,
  AppointmentStatus,
} from '@/domain/entities/appointment';
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
  /**
   * Flusso: per default SOLO le accettazioni in entrata (INTAKE), così coda, monitor, promemoria,
   * portale e chiusura giornata non vedono mai le riconsegne; 'RETURN' per la scheda Riconsegne,
   * 'ALL' per la sync, che riconcilia entrambi i flussi.
   */
  readonly flow?: AppointmentFlow | 'ALL';
}

/** Ricerca nello storico: per targa (normalizzata, anche parziale) e/o per codice pratica. */
export interface AppointmentHistoryQuery {
  readonly plate?: string;
  readonly code?: string;
}

/** Riepilogo di una reconciliation (usato dal SyncService in M1). */
export interface UpsertSummary {
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly cancelled: number;
}

/** Ambito del conteggio "clienti prima di te". */
/** Repository delle pratiche. Restituisce sempre copie immutabili. */
export interface IAppointmentRepository {
  findById(id: AppointmentId): Promise<Appointment | null>;
  findByExternalRef(externalRef: string, businessDate: IsoDate): Promise<Appointment | null>;
  findByCode(code: QueueCode, businessDate: IsoDate): Promise<Appointment | null>;
  /** Pratiche in entrata (INTAKE) della targa nella giornata: è la ricerca del portale cliente. */
  findByPlate(plate: PlateNumber, businessDate: IsoDate): Promise<readonly Appointment[]>;
  /**
   * Storico su tutte le giornate e i flussi, dalla più recente: la storia di un veicolo (o una
   * pratica per codice) per l'archivio. Con targa e codice vuoti non restituisce nulla.
   */
  searchHistory(query: AppointmentHistoryQuery, limit: number): Promise<readonly Appointment[]>;
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
  update(
    appointment: Appointment,
    expectedVersion: number,
  ): Promise<Result<Appointment, DomainError>>;
  /** Contatore atomico per (giornata, prefisso): il numero restituito non viene mai riutilizzato. */
  reserveNextSequence(businessDate: IsoDate, prefix: string): Promise<number>;
  /** Pratiche WAITING/SKIPPED con (scheduledAt, sequence) precedente, nell'ambito indicato. */
  /** Svuota le pratiche (solo test); senza argomento svuota tutto. */
  clear(businessDate?: IsoDate): Promise<void>;
}
