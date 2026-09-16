// Contratto dati fra Route Handler (`/api/v1/queue`, `/api/v1/appointments/[id]/actions`) e
// dashboard client. Solo tipi: nessuna dipendenza da implementazioni.
import type { Session } from '@/application/auth/IAuthService';
import type { BayOccupancyView } from '@/application/queue/QueueService';
import type { AppointmentFlow } from '@/domain/entities/appointment';
import type { Brand } from '@/domain/entities/brand';
import type { Desk } from '@/domain/entities/desk';
import type { SyncRun } from '@/domain/entities/sync-run';
import type { Workstation } from '@/domain/entities/workstation';
import type { DeskId } from '@/domain/ids';
import type { QueueRowView } from '@/domain/read-models';
import type { IsoDate, IsoDateTime } from '@/domain/value-objects/iso-date';

/** Vista della dashboard: il proprio sportello, tutta l'accettazione, oppure le riconsegne. */
export type QueueView = 'desk' | 'global' | 'returns';

/** Risposta di GET /api/v1/queue. */
export interface QueueResponse {
  readonly businessDate: IsoDate;
  readonly serverTime: IsoDateTime;
  readonly timeZone: string;
  readonly view: QueueView;
  /** Flusso delle righe: INTAKE per la coda, RETURN per la scheda Riconsegne. */
  readonly flow: AppointmentFlow;
  /** Riconsegne previste oggi (non annullate), qualunque sia la vista: per il pulsante della scheda. */
  readonly returnsCount: number;
  /** Sportello filtrato (vista sportello) o null (vista globale o riconsegne). */
  readonly deskId: DeskId | null;
  readonly rows: readonly QueueRowView[];
  readonly bays: readonly BayOccupancyView[];
  readonly lastSync: SyncRun | null;
  readonly desks: readonly Desk[];
  readonly brands: readonly Brand[];
  readonly workstations: readonly Workstation[];
}

/**
 * Azioni rapide sulla pratica (POST /api/v1/appointments/[id]/actions).
 * `reschedule` rimette in coda un cliente arrivato in ritardo; `no-show` lo segna assente e
 * deposita l'evento per il CRM.
 */
export type AppointmentAction =
  | 'take'
  | 'skip'
  | 'complete'
  | 'release'
  | 'restore'
  | 'reschedule'
  | 'no-show'
  /** Annullamento deciso da un responsabile o amministratore (assistenza). */
  | 'cancel'
  /** "Completato" premuto per errore, o check-in da rifare: la pratica torna in carico. */
  | 'reopen-completed'
  /** Conferma di una chiusura d'ufficio (responsabile o amministratore). */
  | 'confirm-auto-close'
  /** Cliente segnato assente che si presenta: torna in coda con l'orario di adesso. */
  | 'reactivate';

export interface AppointmentActionRequest {
  readonly action: AppointmentAction;
  readonly expectedVersion: number;
  /** Solo per `take`: campata richiesta esplicitamente. */
  readonly bayId?: string | null;
  /** Solo per `no-show`: motivo annotato per il BDC. */
  readonly reason?: string | null;
}

/** Sessione serializzata per i componenti client (identica a `Session`, senza brand nominali). */
export type SessionView = Session;

/** Parametri della query della coda lato client. */
export interface QueueParams {
  readonly date: string | null;
  readonly deskId: string | null;
  readonly view: QueueView;
}
