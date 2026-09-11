// Caso d'uso della coda di accettazione (modulo A): letture arricchite e transizioni di stato
// con state machine, concorrenza ottimistica (version) e invariante "una pratica in carico per
// campata". Dipende solo da interfacce: identico con repository in-memory o Prisma.
import {
  ACTIVE_QUEUE_STATUSES,
  effectiveScheduleTime,
  isInQueue,
  type Appointment,
  type AppointmentStatus,
} from '@/domain/entities/appointment';
import type { Bay } from '@/domain/entities/bay';
import type { Desk } from '@/domain/entities/desk';
import { RELEASING_DISPLAY_MS } from '@/config/constants';
import { assertTransition } from '@/domain/appointment-state-machine';
import { domainError, type DomainError } from '@/domain/errors';
import type { AppointmentId, BayId, DeskId, OperatorId, WorkstationId } from '@/domain/ids';
import type {
  BayDisplayView,
  QueuePositionView,
  QueueRowView,
  WaitingBoardView,
} from '@/domain/read-models';
import { err, ok, type Result } from '@/domain/result';
import type { IsoDate } from '@/domain/value-objects/iso-date';
import { parsePlate, type PlateNumber } from '@/domain/value-objects/plate';
import type {
  IAppointmentRepository,
  INotificationRepository,
  IOperatorRepository,
  IReferenceDataRepository,
} from '@/repositories/interfaces';
import type { CrmNotifier } from '../crm/CrmNotifier';
import type { IClock } from '@/services/interfaces/IClock';
import type { IEventBus } from '@/services/interfaces/IEventBus';
import type { IIdGenerator } from '@/services/interfaces/IIdGenerator';
import type { ILogger } from '@/services/interfaces/ILogger';

export interface QueueServiceDeps {
  readonly appointments: IAppointmentRepository;
  readonly referenceData: IReferenceDataRepository;
  readonly operators: IOperatorRepository;
  /** Serve solo a mostrare nella coda se il cliente è già stato avvisato. */
  readonly notifications: INotificationRepository;
  /** Invio degli eventi al CRM/BDC (no-show da ricontattare), tramite coda di uscita. */
  readonly crmNotifier: CrmNotifier;
  readonly eventBus: IEventBus;
  readonly clock: IClock;
  readonly ids: IIdGenerator;
  readonly logger: ILogger;
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
      isInQueue(appointment.status) ? this.countAheadSameDesk(appointment) : Promise.resolve(0),
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

  /**
   * Stato del monitor di una campata (modulo D): unico proprietario della regola di visualizzazione.
   * La campata è identificata dal codice ("C1") oppure dal solo numero ("1"), come lo scrive
   * l'installatore nell'URL del kiosk.
   *
   * - pratica `IN_PROGRESS` su quella campata → `SERVING` con codice e targa;
   * - appena completata (entro `RELEASING_DISPLAY_MS`) → `RELEASING`: il monitor invita ad avanzare
   *   mostrando ancora il codice appena servito, così il cliente successivo capisce che tocca a lui;
   * - altrimenti → `FREE`. `OFFLINE` non è mai restituito dal server: lo decide il client quando
   *   il polling non risponde più (un monitor scollegato deve accorgersene da solo).
   */
  async getBayDisplay(
    bayRef: string,
    businessDate: IsoDate,
  ): Promise<Result<BayDisplayView, DomainError>> {
    const bays = await this.deps.referenceData.listBays();
    const wanted = bayRef.trim().toUpperCase();
    const bay =
      bays.find((b) => b.code.toUpperCase() === wanted) ??
      bays.find((b) => String(b.number) === wanted);
    if (bay === undefined) {
      return err(
        domainError('NOT_FOUND', `Accettazione sconosciuta: "${bayRef}".`, {
          bayRef,
          campateAttive: bays.filter((b) => b.isActive).map((b) => b.code),
        }),
      );
    }

    const onThisBay = (await this.deps.appointments.listByDate(businessDate)).filter(
      (a) => a.bayId === bay.id,
    );
    const serving = onThisBay.find((a) => a.status === 'IN_PROGRESS') ?? null;
    const lastCompleted =
      onThisBay
        .filter((a) => a.status === 'COMPLETED' && a.completedAt !== null)
        .sort((x, y) => (x.completedAt ?? '').localeCompare(y.completedAt ?? ''))
        .at(-1) ?? null;

    const base = { bayCode: bay.code, bayNumber: bay.number, bayName: bay.name } as const;
    if (serving !== null) {
      return ok({
        ...base,
        state: 'SERVING',
        currentCode: serving.code,
        currentPlate: serving.vehicle.plate,
        since: serving.takenAt,
        lastCompletedCode: lastCompleted?.code ?? null,
        lastCompletedAt: lastCompleted?.completedAt ?? null,
      });
    }

    const releasing =
      lastCompleted?.completedAt !== undefined &&
      lastCompleted.completedAt !== null &&
      this.deps.clock.now().getTime() - new Date(lastCompleted.completedAt).getTime() <
        RELEASING_DISPLAY_MS;

    return ok({
      ...base,
      state: releasing ? 'RELEASING' : 'FREE',
      currentCode: null,
      currentPlate: null,
      since: null,
      lastCompletedCode: lastCompleted?.code ?? null,
      lastCompletedAt: lastCompleted?.completedAt ?? null,
    });
  }

  /**
   * Tabellone della sala d'attesa (modulo D): codici chiamati ora con la loro destinazione e i
   * prossimi in attesa. Espone solo codici: lo schermo è visibile a tutta la sala, quindi né
   * targhe né nomi.
   */
  async getWaitingBoard(businessDate: IsoDate, nextCount = 4): Promise<WaitingBoardView> {
    const [all, bays, desks] = await Promise.all([
      this.deps.appointments.listByDate(businessDate),
      this.deps.referenceData.listBays(),
      this.deps.referenceData.listDesks(),
    ]);
    const bayById = new Map(bays.map((b) => [b.id, b] as const));
    const deskById = new Map(desks.map((d) => [d.id, d] as const));

    const serving = all
      .filter((a) => a.status === 'IN_PROGRESS')
      .map((a) => {
        const bay = a.bayId === null ? undefined : bayById.get(a.bayId);
        const desk = a.deskId === null ? undefined : deskById.get(a.deskId);
        return {
          code: a.code,
          bayCode: bay?.code ?? null,
          bayNumber: bay?.number ?? null,
          deskCode: desk?.code ?? null,
          since: a.takenAt,
        };
      })
      // Chi è stato chiamato per ultimo va in cima: è la riga che la sala deve notare.
      .sort((x, y) => (y.since ?? '').localeCompare(x.since ?? ''));

    const inQueue = all.filter((a) => isInQueue(a.status));
    return {
      serving,
      next: inQueue
        .slice(0, Math.max(0, nextCount))
        .map((a) => ({ code: a.code, scheduledAt: a.scheduledAt })),
      waitingCount: inQueue.length,
    };
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

  /**
   * Rimette in coda un cliente arrivato in ritardo: la pratica torna WAITING e l'orario atteso
   * diventa adesso, così esce dal blocco "in ritardo" e si ricolloca nella coda del momento.
   * `scheduledAt` non viene toccato: resta l'orario dell'agenda, e una sincronizzazione successiva
   * non annulla questa decisione.
   */
  async rescheduleToNow(
    input: TransitionInput,
    ctx: ActionContext,
  ): Promise<Result<Appointment, DomainError>> {
    const current = await this.load(input.appointmentId);
    if (!current.ok) {
      return current;
    }
    const a = current.value;
    // Il caso normale è una pratica già WAITING: non c'è un cambio di stato da validare, si
    // aggiorna solo l'orario atteso. Da SKIPPED invece si torna in attesa, e quella transizione
    // va verificata come tutte le altre.
    if (!isInQueue(a.status)) {
      return err(
        domainError(
          'INVALID_TRANSITION',
          `Solo una pratica in coda può essere rimessa in coda: questa è ${a.status}.`,
          { from: a.status },
        ),
      );
    }
    return this.apply(
      a,
      'WAITING',
      { rescheduledAt: this.deps.clock.nowIso(), skippedAt: null },
      input.expectedVersion,
      ctx,
    );
  }

  /**
   * Segna il cliente come assente (WAITING|SKIPPED → NO_SHOW) e deposita l'evento per il CRM
   * nella outbox: il BDC potrà ricontattarlo. L'invio effettivo al CRM avviene altrove (M6),
   * qui si registra soltanto, con una chiave che impedisce doppioni sulla stessa giornata.
   */
  async markNoShow(
    input: TransitionInput & { readonly reason?: string | undefined },
    ctx: ActionContext,
  ): Promise<Result<Appointment, DomainError>> {
    const updated = await this.transition(input, ctx, 'NO_SHOW', () => ({
      noShowAt: this.deps.clock.nowIso(),
    }));
    if (!updated.ok) {
      return updated;
    }
    // La consegna al CRM è affidata al notificatore, che scrive in coda di uscita e prova a
    // inviare: un CRM irraggiungibile non deve impedire di segnare un cliente assente.
    await this.deps.crmNotifier.notifyNoShow(
      updated.value,
      input.reason ?? null,
      ctx.correlationId ?? this.deps.ids.next(),
    );
    return updated;
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

  /**
   * "Clienti prima di te" per il portale: conta solo le pratiche in coda dello STESSO sportello,
   * perché ogni sportello serve la propria fila e i clienti degli altri marchi non fanno attendere
   * chi aspetta qui. Lo sportello è quello indicato da Infinity oppure, quando manca, quello che
   * serve il marchio della vettura: la stessa regola con cui la dashboard raggruppa la coda, così
   * il numero mostrato al cliente coincide con quello che vede l'accettatore.
   * Il confronto usa l'orario effettivo, quindi un cliente rimesso in coda dopo un ritardo non
   * risulta più davanti a chi era arrivato puntuale.
   */
  private async countAheadSameDesk(appointment: Appointment): Promise<number> {
    const [inQueue, desks] = await Promise.all([
      this.deps.appointments.listByDate(appointment.businessDate, {
        statuses: [...ACTIVE_QUEUE_STATUSES],
      }),
      this.deps.referenceData.listDesks(),
    ]);
    const deskKey = (a: Appointment): string => {
      if (a.deskId !== null) {
        return a.deskId;
      }
      const desk = desks.find((d) => d.brandIds.includes(a.brandId));
      // Senza sportello né marchio riconosciuto la pratica fa fila a sé: meglio un conteggio
      // prudente che sommare clienti di sportelli diversi.
      return desk?.id ?? `brand:${a.brandId}`;
    };

    const mioSportello = deskKey(appointment);
    const mioOrario = effectiveScheduleTime(appointment);
    return inQueue.filter(
      (other) =>
        other.id !== appointment.id &&
        deskKey(other) === mioSportello &&
        // A pari orario decide la sequenza del codice: l'ordine è quello della coda.
        (effectiveScheduleTime(other) < mioOrario ||
          (effectiveScheduleTime(other) === mioOrario && other.sequence < appointment.sequence)),
    ).length;
  }

  private belongsToDesk(a: Appointment, desk: Desk): boolean {
    if (a.deskId !== null) {
      return a.deskId === desk.id;
    }
    return desk.brandIds.includes(a.brandId);
  }

  private async enrich(appointments: readonly Appointment[]): Promise<readonly QueueRowView[]> {
    const businessDate = appointments[0]?.businessDate ?? null;
    const [bays, jobs] = await Promise.all([
      this.deps.referenceData.listBays(),
      businessDate === null
        ? Promise.resolve([])
        : this.deps.notifications.listByDate(businessDate),
    ]);
    const operatorIds = [
      ...new Set(appointments.flatMap((a) => (a.operatorId === null ? [] : [a.operatorId]))),
    ];
    const operators = await Promise.all(operatorIds.map((id) => this.deps.operators.findById(id)));
    const operatorName = new Map(
      operators.flatMap((o) => (o === null ? [] : [[o.id, o.displayName] as const])),
    );
    const bayCode = new Map(bays.map((b) => [b.id, b.code] as const));
    // Una pratica può avere più notifiche (promemoria, "è il tuo turno"): all'accettatore interessa
    // l'ultima, cioè l'esito del contatto più recente. I job arrivano ordinati per creazione.
    const lastJob = new Map(jobs.map((j) => [j.appointmentId, j] as const));

    return appointments.map((appointment) => {
      const job = lastJob.get(appointment.id) ?? null;
      return {
        appointment,
        operatorName:
          appointment.operatorId === null
            ? null
            : (operatorName.get(appointment.operatorId) ?? null),
        bayCode: appointment.bayId === null ? null : (bayCode.get(appointment.bayId) ?? null),
        notificationStatus: job?.status ?? null,
        notificationChannel: job?.currentChannel ?? null,
      };
    });
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
          domainError('VALIDATION', 'Accettazione sconosciuta o non attiva.', { bayId: requested }),
        );
      }
      if (slot.appointment !== null && slot.appointment.id !== a.id) {
        return err(
          domainError(
            'BAY_BUSY',
            `L'accettazione ${slot.bay.code} è occupata dalla pratica ${slot.appointment.code}.`,
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
