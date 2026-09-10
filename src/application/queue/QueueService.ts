// Caso d'uso della coda di accettazione (modulo A): letture arricchite e transizioni di stato
// con state machine, concorrenza ottimistica (version) e invariante "una pratica in carico per
// campata". Dipende solo da interfacce: identico con repository in-memory o Prisma.
import { isInQueue, type Appointment, type AppointmentStatus } from '@/domain/entities/appointment';
import type { Bay } from '@/domain/entities/bay';
import type { Desk } from '@/domain/entities/desk';
import { assertTransition } from '@/domain/appointment-state-machine';
import { domainError, type DomainError } from '@/domain/errors';
import type { AppointmentId, BayId, DeskId, OperatorId, WorkstationId } from '@/domain/ids';
import type { QueuePositionView, QueueRowView } from '@/domain/read-models';
import { err, ok, type Result } from '@/domain/result';
import type { IsoDate } from '@/domain/value-objects/iso-date';
import { parsePlate, type PlateNumber } from '@/domain/value-objects/plate';
import type {
  AheadScope,
  IAppointmentRepository,
  IOperatorRepository,
  IReferenceDataRepository,
} from '@/repositories/interfaces';
import type { IClock } from '@/services/interfaces/IClock';
import type { IEventBus } from '@/services/interfaces/IEventBus';
import type { IIdGenerator } from '@/services/interfaces/IIdGenerator';
import type { ILogger } from '@/services/interfaces/ILogger';

export interface QueueServiceDeps {
  readonly appointments: IAppointmentRepository;
  readonly referenceData: IReferenceDataRepository;
  readonly operators: IOperatorRepository;
  readonly eventBus: IEventBus;
  readonly clock: IClock;
  readonly ids: IIdGenerator;
  readonly logger: ILogger;
  /**
   * Ambito del conteggio "clienti prima di te" del portale (`QUEUE_AHEAD_SCOPE`):
   * `SITE` conta tutta l'accettazione, `DESK` solo lo sportello della pratica.
   */
  readonly queueAheadScope: AheadScope;
}

/** Filtro della dashboard: sportello proprio oppure vista globale di tutta l'accettazione. */
export interface QueueQuery {
  readonly businessDate: IsoDate;
  readonly deskId: DeskId | null;
  readonly globalView: boolean;
}

/** Chi esegue l'azione (dalla sessione) e con quale correlazione. */
export interface ActionContext {
  readonly operatorId: OperatorId;
  readonly workstationId: WorkstationId | null;
  readonly correlationId: string | null;
}

export interface TransitionInput {
  readonly appointmentId: AppointmentId;
  /** Versione vista dal client: se diversa da quella corrente → VERSION_CONFLICT (409). */
  readonly expectedVersion: number;
}

export interface TakeInChargeInput extends TransitionInput {
  /** Campata richiesta esplicitamente; null = proponi quella della postazione o la prima libera. */
  readonly bayId: BayId | null;
}

/** Occupazione derivata di una campata: la pratica IN_PROGRESS che la occupa, se c'è. */
export interface BayOccupancyView {
  readonly bay: Bay;
  readonly appointment: Appointment | null;
}

export class QueueService {
  private readonly logger: ILogger;

  constructor(private readonly deps: QueueServiceDeps) {
    this.logger = deps.logger.child('[Queue]');
  }

  /**
   * Coda della giornata ordinata per (orario, sequenza). Senza vista globale mostra le pratiche
   * dello sportello indicato più quelle senza sportello ma di un marchio servito dallo sportello
   * (Infinity non sempre indica il deskCode).
   */
  async getQueue(query: QueueQuery): Promise<readonly QueueRowView[]> {
    const all = await this.deps.appointments.listByDate(query.businessDate, {
      includeCancelled: true,
    });
    const desk =
      query.globalView || query.deskId === null
        ? null
        : await this.deps.referenceData.findDeskById(query.deskId);
    const visible = desk === null ? all : all.filter((a) => this.belongsToDesk(a, desk));
    return this.enrich(visible);
  }

  /**
   * Stato pubblico della pratica per il portale cliente (modulo B): unico proprietario della
   * regola "clienti prima di te". Restituisce SOLO dati non personali (codice, stato, conteggio,
   * campata, marchio, orari): nomi, telefoni e modello del veicolo non escono mai da qui.
   *
   * - targa non valida → `VALIDATION`; targa non in agenda oggi → `NOT_FOUND`;
   * - più pratiche per la stessa targa: vince quella ancora aperta (in coda o in carico),
   *   altrimenti l'ultima chiusa della giornata;
   * - `aheadCount` è 0 quando la pratica non è più in coda (in carico, completata, chiusa).
   */
  async getPublicPositionByPlate(
    rawPlate: string,
    businessDate: IsoDate,
  ): Promise<Result<QueuePositionView, DomainError>> {
    const plate = parsePlate(rawPlate);
    if (!plate.ok) {
      return plate;
    }
    const appointment = await this.findPublicAppointment(plate.value, businessDate);
    if (appointment === null) {
      return err(
        domainError(
          'NOT_FOUND',
          "Targa non trovata nell'agenda di oggi. Rivolgiti allo sportello dell'accettazione.",
          { plate: plate.value },
        ),
      );
    }
    const [aheadCount, brand, bay] = await Promise.all([
      isInQueue(appointment.status)
        ? this.deps.appointments.countAhead(appointment, this.deps.queueAheadScope)
        : Promise.resolve(0),
      this.deps.referenceData.listBrands(),
      appointment.bayId === null
        ? Promise.resolve(null)
        : this.deps.referenceData.findBayById(appointment.bayId),
    ]);
    return ok({
      code: appointment.code,
      status: appointment.status,
      aheadCount,
      bayNumber: appointment.status === 'IN_PROGRESS' ? (bay?.number ?? null) : null,
      brandCode: brand.find((b) => b.id === appointment.brandId)?.code ?? '',
      scheduledAt: appointment.scheduledAt,
      updatedAt: appointment.updatedAt,
    });
  }

  /** Occupazione di tutte le campate attive, derivata da `status` + `bayId` delle pratiche. */
  async getBayOccupancy(businessDate: IsoDate): Promise<readonly BayOccupancyView[]> {
    const [bays, inProgress] = await Promise.all([
      this.deps.referenceData.listBays(),
      this.deps.appointments.listByDate(businessDate, { statuses: ['IN_PROGRESS'] }),
    ]);
    return bays
      .filter((b) => b.isActive)
      .map((bay) => ({
        bay,
        appointment: inProgress.find((a) => a.bayId === bay.id) ?? null,
      }));
  }

  /**
   * Prendi in carico: WAITING|SKIPPED → IN_PROGRESS. Sceglie la campata (richiesta, predefinita
   * della postazione, prima libera); una campata richiesta ma occupata → BAY_BUSY con le libere.
   * Se nessuna campata è libera la pratica viene comunque presa in carico senza campata:
   * l'officina non si blocca per un dato di configurazione.
   */
  async takeInCharge(
    input: TakeInChargeInput,
    ctx: ActionContext,
  ): Promise<Result<Appointment, DomainError>> {
    const current = await this.load(input.appointmentId);
    if (!current.ok) {
      return current;
    }
    const a = current.value;
    const transition = assertTransition(a.status, 'IN_PROGRESS');
    if (!transition.ok) {
      return transition;
    }
    const bay = await this.chooseBay(a, input.bayId, ctx.workstationId);
    if (!bay.ok) {
      return bay;
    }
    return this.apply(
      a,
      'IN_PROGRESS',
      {
        bayId: bay.value,
        operatorId: ctx.operatorId,
        takenAt: this.deps.clock.nowIso(),
      },
      input.expectedVersion,
      ctx,
    );
  }

  /** Salta: la pratica resta al proprio orario, evidenziata; `skipCount + 1`. */
  async skip(
    input: TransitionInput,
    ctx: ActionContext,
  ): Promise<Result<Appointment, DomainError>> {
    return this.transition(input, ctx, 'SKIPPED', (a) => ({
      skipCount: a.skipCount + 1,
      skippedAt: this.deps.clock.nowIso(),
    }));
  }

  /** Completato: IN_PROGRESS → COMPLETED, la campata si libera (occupazione derivata). */
  async complete(
    input: TransitionInput,
    ctx: ActionContext,
  ): Promise<Result<Appointment, DomainError>> {
    return this.transition(input, ctx, 'COMPLETED', () => ({
      completedAt: this.deps.clock.nowIso(),
    }));
  }

  /** Rilascia: annulla una presa in carico errata (IN_PROGRESS → WAITING). */
  async release(
    input: TransitionInput,
    ctx: ActionContext,
  ): Promise<Result<Appointment, DomainError>> {
    return this.transition(input, ctx, 'WAITING', () => ({
      bayId: null,
      operatorId: null,
      takenAt: null,
    }));
  }

  /** Ripristina: SKIPPED → WAITING mantenendo `skipCount` (serve all'anomalia EXCESSIVE_SKIPS). */
  async restore(
    input: TransitionInput,
    ctx: ActionContext,
  ): Promise<Result<Appointment, DomainError>> {
    return this.transition(input, ctx, 'WAITING', () => ({ skippedAt: null }));
  }

  // --- interni ---------------------------------------------------------------------------

  /**
   * Pratica da mostrare al cliente fra quelle con la stessa targa nella giornata:
   * la prima ancora aperta (in coda o in carico) per orario, altrimenti l'ultima chiusa.
   */
  private async findPublicAppointment(
    plate: PlateNumber,
    businessDate: IsoDate,
  ): Promise<Appointment | null> {
    const found = await this.deps.appointments.findByPlate(plate, businessDate);
    const open = found.find((a) => isInQueue(a.status) || a.status === 'IN_PROGRESS');
    return open ?? found.at(-1) ?? null;
  }

  private belongsToDesk(a: Appointment, desk: Desk): boolean {
    if (a.deskId !== null) {
      return a.deskId === desk.id;
    }
    return desk.brandIds.includes(a.brandId);
  }

  private async enrich(appointments: readonly Appointment[]): Promise<readonly QueueRowView[]> {
    const bays = await this.deps.referenceData.listBays();
    const operatorIds = [
      ...new Set(appointments.flatMap((a) => (a.operatorId === null ? [] : [a.operatorId]))),
    ];
    const operators = await Promise.all(operatorIds.map((id) => this.deps.operators.findById(id)));
    const operatorName = new Map(
      operators.flatMap((o) => (o === null ? [] : [[o.id, o.displayName] as const])),
    );
    const bayCode = new Map(bays.map((b) => [b.id, b.code] as const));
    return appointments.map((appointment) => ({
      appointment,
      operatorName:
        appointment.operatorId === null ? null : (operatorName.get(appointment.operatorId) ?? null),
      bayCode: appointment.bayId === null ? null : (bayCode.get(appointment.bayId) ?? null),
      notificationStatus: null,
    }));
  }

  private async load(id: AppointmentId): Promise<Result<Appointment, DomainError>> {
    const a = await this.deps.appointments.findById(id);
    return a === null ? err(domainError('NOT_FOUND', `Pratica non trovata: ${id}.`)) : ok(a);
  }

  private async chooseBay(
    a: Appointment,
    requested: BayId | null,
    workstationId: WorkstationId | null,
  ): Promise<Result<BayId | null, DomainError>> {
    const occupancy = await this.getBayOccupancy(a.businessDate);
    const free = occupancy.filter((o) => o.appointment === null).map((o) => o.bay);
    if (requested !== null) {
      const slot = occupancy.find((o) => o.bay.id === requested);
      if (slot === undefined) {
        return err(
          domainError('VALIDATION', 'Campata sconosciuta o non attiva.', { bayId: requested }),
        );
      }
      if (slot.appointment !== null && slot.appointment.id !== a.id) {
        return err(
          domainError(
            'BAY_BUSY',
            `La campata ${slot.bay.code} è occupata dalla pratica ${slot.appointment.code}.`,
            {
              bayId: requested,
              occupiedBy: slot.appointment.code,
              freeBays: free.map((b) => ({ id: b.id, code: b.code, name: b.name })),
            },
          ),
        );
      }
      return ok(requested);
    }
    const workstation =
      workstationId === null
        ? null
        : await this.deps.referenceData.findWorkstationById(workstationId);
    const preferred = workstation?.defaultBayId ?? null;
    if (preferred !== null && free.some((b) => b.id === preferred)) {
      return ok(preferred);
    }
    const first = free[0];
    if (first === undefined) {
      this.logger.warn('nessuna campata libera: presa in carico senza campata', {
        appointmentId: a.id,
      });
      return ok(null);
    }
    return ok(first.id);
  }

  private async transition(
    input: TransitionInput,
    ctx: ActionContext,
    to: AppointmentStatus,
    patch: (a: Appointment) => Partial<Appointment>,
  ): Promise<Result<Appointment, DomainError>> {
    const current = await this.load(input.appointmentId);
    if (!current.ok) {
      return current;
    }
    const a = current.value;
    const transition = assertTransition(a.status, to);
    if (!transition.ok) {
      return transition;
    }
    return this.apply(a, to, patch(a), input.expectedVersion, ctx);
  }

  private async apply(
    a: Appointment,
    to: AppointmentStatus,
    patch: Partial<Appointment>,
    expectedVersion: number,
    ctx: ActionContext,
  ): Promise<Result<Appointment, DomainError>> {
    const updated = await this.deps.appointments.update(
      { ...a, ...patch, status: to },
      expectedVersion,
    );
    if (!updated.ok) {
      return updated;
    }
    const saved = updated.value;
    this.deps.eventBus.publish({
      id: this.deps.ids.next(),
      occurredAt: this.deps.clock.nowIso(),
      correlationId: ctx.correlationId ?? this.deps.ids.next(),
      actor: { kind: 'OPERATOR', id: ctx.operatorId },
      type: 'APPOINTMENT_STATUS_CHANGED',
      appointmentId: saved.id,
      from: a.status,
      to,
      bayId: saved.bayId,
    });
    this.logger.info(`pratica ${saved.code}: ${a.status} → ${to}`, {
      appointmentId: saved.id,
      operatorId: ctx.operatorId,
      bayId: saved.bayId,
    });
    return ok(saved);
  }
}
