// Caso d'uso della coda di accettazione (modulo A): letture arricchite e transizioni di stato
// con state machine, concorrenza ottimistica (version) e invariante "una pratica in carico per
// sportello". Dipende solo da interfacce: identico con repository in-memory o Prisma.
import {
  ACTIVE_QUEUE_STATUSES,
  isAutoClosedPending,
  isInQueue,
  type Appointment,
  type AppointmentStatus,
} from '@/domain/entities/appointment';
import type { AppointmentFlow } from '@/domain/entities/appointment';
import type { OperatorRole } from '@/domain/entities/operator';
import type { Bay } from '@/domain/entities/bay';
import type { Desk } from '@/domain/entities/desk';
import { MAX_SKIPS_BEFORE_ANOMALY, RELEASING_DISPLAY_MS } from '@/config/constants';
import { assertTransition } from '@/domain/appointment-state-machine';
import { domainError, type DomainError } from '@/domain/errors';
import type { AppointmentId, BayId, DeskId, OperatorId, WorkstationId } from '@/domain/ids';
import type { Workstation } from '@/domain/entities/workstation';
import type { WorkstationClaim } from '@/domain/entities/workstation-claim';
import type {
  BayDisplayView,
  BayOccupancyOptionView,
  QueuePositionView,
  QueueRowView,
  WaitingBoardView,
} from '@/domain/read-models';
import { countAheadInSameDesk } from '@/domain/queue-position';
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

/** Motivo registrato sui no-show generati dalla chiusura di giornata. */
export const CLOSE_DAY_NO_SHOW_REASON = 'Chiusura giornata: cliente non presentatosi';

/** Esito della chiusura di giornata, per il messaggio al responsabile e per i log. */
export interface CloseBusinessDayResult {
  readonly businessDate: IsoDate;
  /** Codici passati a NO_SHOW (clienti mai presentati: diventano lead per il BDC). */
  readonly noShow: readonly string[];
  /** Codici chiusi d'ufficio: erano in carico, diventano COMPLETED "da confermare". */
  readonly autoClosed: readonly string[];
  /** Codici che non è stato possibile chiudere (conflitto con un'altra postazione). */
  readonly failed: readonly string[];
  /** Pratiche già chiuse prima della chiusura di giornata. */
  readonly alreadyClosed: number;
}

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
  /** INTAKE (default): la coda. RETURN: la scheda Riconsegne, che non è divisa per sportello. */
  readonly flow?: AppointmentFlow;
}

/** Chi esegue l'azione (dalla sessione) e con quale correlazione. */
export interface ActionContext {
  readonly operatorId: OperatorId;
  readonly workstationId: WorkstationId | null;
  readonly correlationId: string | null;
  /**
   * Chi ha deciso l'azione. `SYSTEM` è per le automazioni (chiusura di giornata a fine turno):
   * nel registro degli eventi deve restare scritto che non è stata una persona, altrimenti
   * domani qualcuno cercherà il collega che ha segnato quaranta assenti alle 19:00.
   */
  readonly actorKind?: 'OPERATOR' | 'SYSTEM';
  /** Ruolo di chi agisce: serve alle regole che distinguono il banco dal responsabile. */
  readonly role?: OperatorRole;
}

/** Operatore fittizio usato dalle automazioni quando nessuna persona ha premuto un pulsante. */
export const SYSTEM_ACTOR_ID = 'system' as OperatorId;

export interface TransitionInput {
  readonly appointmentId: AppointmentId;
  /** Versione vista dal client: se diversa da quella corrente → VERSION_CONFLICT (409). */
  readonly expectedVersion: number;
}

export interface TakeInChargeInput extends TransitionInput {
  /** Sportello richiesto esplicitamente; null = proponi quello della postazione o il primo libero. */
  readonly bayId: BayId | null;
}

/** Occupazione derivata di uno sportello: la pratica IN_PROGRESS che lo occupa, se c'è. */
export interface BayOccupancyView {
  readonly bay: Bay;
  readonly appointment: Appointment | null;
}

/**
 * L'occupazione degli sportelli come esce dall'API della coda: lo sportello perde il
 * `displayToken`, che è il segreto con cui i monitor kiosk si autenticano. Alla dashboard servono
 * lettera e nome; il token no, e una risposta che ogni sessione operatore può leggere non è il
 * posto dove tenerlo.
 */
export function toBayOccupancyOptions(
  occupancy: readonly BayOccupancyView[],
  /** Postazioni: legano lo sportello alla sua area di marchio (`defaultBayId`). */
  workstations: readonly Workstation[] = [],
  /** Rivendicazioni attive: dicono chi è seduto a ogni postazione, e quindi a ogni sportello. */
  claims: readonly WorkstationClaim[] = [],
): readonly BayOccupancyOptionView[] {
  return occupancy.map((o) => {
    const postazione = workstations.find((w) => w.defaultBayId === o.bay.id) ?? null;
    const claim =
      postazione === null ? null : (claims.find((c) => c.workstationId === postazione.id) ?? null);
    return {
      bay: {
        id: o.bay.id,
        code: o.bay.code,
        number: o.bay.number,
        name: o.bay.name,
        isActive: o.bay.isActive,
      },
      appointment: o.appointment,
      deskId: postazione?.deskId ?? null,
      operatorName: claim?.operatorName ?? null,
    };
  });
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
    const flow = query.flow ?? 'INTAKE';
    const all = await this.deps.appointments.listByDate(query.businessDate, {
      includeCancelled: true,
      flow,
    });
    const desk =
      flow === 'RETURN' || query.globalView || query.deskId === null
        ? null
        : await this.deps.referenceData.findDeskById(query.deskId);
    const visible = desk === null ? all : all.filter((a) => this.belongsToDesk(a, desk));
    return this.enrich(visible);
  }

  /**
   * Stato pubblico della pratica per il portale cliente (modulo B): unico proprietario della
   * regola "clienti prima di te". Restituisce SOLO dati non personali (codice, stato, conteggio,
   * sportello, marchio, orari): nomi, telefoni e modello del veicolo non escono mai da qui.
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
      // Al cliente si dice la lettera dello sportello: è quella scritta sul monitor e sul tabellone.
      bayCode: appointment.status === 'IN_PROGRESS' ? (bay?.code ?? null) : null,
      brandCode: brand.find((b) => b.id === appointment.brandId)?.code ?? '',
      scheduledAt: appointment.scheduledAt,
      updatedAt: appointment.updatedAt,
    });
  }

  /**
   * Stato del monitor di uno sportello (modulo D): unico proprietario della regola di
   * visualizzazione. Lo sportello è identificato dalla lettera ("A"), dal numero della postazione
   * ("1") o dal vecchio codice di campata ("C1"), come lo scrive l'installatore nell'URL del
   * kiosk: i monitor già configurati non vanno rifatti solo perché le targhette ora sono lettere.
   *
   * - pratica `IN_PROGRESS` su quello sportello → `SERVING` con codice e targa;
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
    // "C2" è la vecchia targhetta della campata: vale ancora come numero della postazione.
    const legacy = /^C(\d+)$/.exec(wanted)?.[1] ?? null;
    const bay =
      bays.find((b) => b.code.toUpperCase() === wanted) ??
      bays.find((b) => String(b.number) === wanted) ??
      (legacy === null ? undefined : bays.find((b) => String(b.number) === legacy));
    if (bay === undefined) {
      return err(
        domainError('NOT_FOUND', `Sportello sconosciuto: "${bayRef}".`, {
          bayRef,
        }),
      );
    }

    const onThisBay = (await this.deps.appointments.listByDate(businessDate)).filter(
      (a) => a.bayId === bay.id,
    );
    const serving = onThisBay.find((a) => a.status === 'IN_PROGRESS') ?? null;
    const lastCompleted =
      onThisBay
        .filter(
          (a) => a.status === 'COMPLETED' && a.completedAt !== null && a.autoClosedAt === null,
        )
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
   * Prendi in carico: WAITING|SKIPPED → IN_PROGRESS. Sceglie lo sportello (richiesto, predefinito
   * della postazione, primo libero); uno sportello richiesto ma occupato → BAY_BUSY con i liberi.
   * Se nessuno sportello è libero la pratica viene comunque presa in carico senza sportello:
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
    const updated = await this.apply(
      a,
      'IN_PROGRESS',
      {
        bayId: bay.value,
        operatorId: ctx.operatorId,
        takenAt: this.deps.clock.nowIso(),
        // Il cliente c'era: la serie dei salti consecutivi finisce qui.
        skipCount: 0,
      },
      input.expectedVersion,
      ctx,
    );
    if (updated.ok && a.skipCount >= MAX_SKIPS_BEFORE_ANOMALY) {
      // La presenza è verificata: il cliente è al banco. Il BDC non deve chiamarlo.
      await this.deps.crmNotifier.resolveAnomaly(
        updated.value,
        'EXCESSIVE_SKIPS',
        ctx.operatorId,
        'Cliente presente: pratica presa in carico al banco.',
      );
    }
    return updated;
  }

  /**
   * Salta: la pratica resta al proprio orario, evidenziata; `skipCount + 1`.
   *
   * Al terzo salto della stessa pratica (`MAX_SKIPS_BEFORE_ANOMALY`) il cliente probabilmente non
   * è in sala: si registra un'anomalia sulla pratica, che arriva al BDC e all'amministratore
   * («Cliente saltato 3 volte - Verificare presenza»). I salti non si azzerano con «Ripristina»:
   * finché la pratica non viene presa in carico sono salti consecutivi della stessa persona. La
   * presa in carico azzera la serie (il cliente c'era): se poi la pratica torna in coda e viene
   * saltata altre tre volte, l'anomalia della giornata si riapre.
   */
  async skip(
    input: TransitionInput,
    ctx: ActionContext,
  ): Promise<Result<Appointment, DomainError>> {
    const updated = await this.transition(input, ctx, 'SKIPPED', (a) => ({
      skipCount: a.skipCount + 1,
      skippedAt: this.deps.clock.nowIso(),
    }));
    if (updated.ok && updated.value.skipCount >= MAX_SKIPS_BEFORE_ANOMALY) {
      // Non blocca il banco: il notificatore non lancia, e un CRM giù lascia l'evento in coda.
      await this.deps.crmNotifier.notifyAnomaly(
        updated.value,
        'EXCESSIVE_SKIPS',
        excessiveSkipsDescription(updated.value.skipCount),
        ctx.correlationId ?? this.deps.ids.next(),
        { skippedAt: updated.value.skippedAt, operatorId: ctx.operatorId },
        // Una serie nuova che arriva a tre riapre l'anomalia chiusa; il quarto salto della stessa
        // serie no, se il BDC l'aveva già verificata.
        { reopenIfClosed: updated.value.skipCount === MAX_SKIPS_BEFORE_ANOMALY },
      );
    }
    return updated;
  }

  /** Completato: IN_PROGRESS → COMPLETED, lo sportello si libera (occupazione derivata). */
  async complete(
    input: TransitionInput,
    ctx: ActionContext,
  ): Promise<Result<Appointment, DomainError>> {
    // Una pratica in carico la chiude chi l'ha in carico, oppure un responsabile o l'amministratore:
    // dal banco A non si completa il cliente del banco B, che il collega sta ancora servendo. Le
    // automazioni (chiusura di giornata) restano libere: non hanno un operatore.
    const current = await this.load(input.appointmentId);
    if (!current.ok) {
      return current;
    }
    const a = current.value;
    const altrui = a.operatorId !== null && a.operatorId !== ctx.operatorId;
    const privilegiato =
      ctx.actorKind === 'SYSTEM' || ctx.role === 'ADMIN' || ctx.role === 'SUPERVISOR';
    if (altrui && !privilegiato) {
      return err(
        domainError(
          'INVALID_TRANSITION',
          'La pratica è in carico a un altro accettatore: la completa lui, un responsabile o un amministratore.',
          { operatorId: a.operatorId },
        ),
      );
    }
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

  /**
   * Ripristina: SKIPPED → WAITING mantenendo `skipCount`, che conta i salti consecutivi (serve
   * all'anomalia EXCESSIVE_SKIPS) e si azzera solo con la presa in carico.
   */
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

  /**
   * Annulla una pratica (in coda o in carico → CANCELLED). È la leva dell'assistenza per una
   * pratica incagliata che non ha più senso: la state machine la ammette da WAITING, SKIPPED e
   * IN_PROGRESS; il controllo del ruolo (responsabile o amministratore) sta nella rotta.
   */
  async cancel(
    input: TransitionInput,
    ctx: ActionContext,
  ): Promise<Result<Appointment, DomainError>> {
    return this.transition(input, ctx, 'CANCELLED', () => ({
      cancelledAt: this.deps.clock.nowIso(),
      bayId: null,
    }));
  }

  /**
   * Chiusura della giornata: a officina chiusa non deve restare nulla di aperto.
   * - chi era ancora in coda (in attesa o saltato) diventa `NO_SHOW` e finisce nel cruscotto BDC
   *   con l'evento verso il CRM: non si è presentato, e domani qualcuno deve richiamarlo;
   * - chi era ancora in carico viene chiuso d'ufficio: `COMPLETED` con `autoClosedAt`, perché
   *   quasi sempre il veicolo è stato accettato e qualcuno ha dimenticato di premere Completato.
   *   Resta "da confermare": il responsabile conferma (e il CRM riceve il check-in) oppure
   *   l'operatore riapre e rifà il giro. Non si annulla: annullare cancellerebbe lavoro fatto.
   * Le pratiche già chiuse (completate, assenti, annullate) non vengono toccate.
   *
   * L'operazione non si ferma al primo errore: se una pratica viene modificata da una postazione
   * proprio in quel momento, quella riga resta indietro e viene contata, il resto della giornata
   * si chiude comunque. Chiudere a metà è meglio che non chiudere.
   */
  async closeBusinessDay(
    businessDate: IsoDate,
    ctx: ActionContext,
  ): Promise<Result<CloseBusinessDayResult, DomainError>> {
    const tutte = await this.deps.appointments.listByDate(businessDate, { includeCancelled: true });
    const daChiudere = tutte.filter((a) => isInQueue(a.status) || a.status === 'IN_PROGRESS');

    const noShow: string[] = [];
    const autoClosed: string[] = [];
    const nonRiuscite: string[] = [];

    for (const a of daChiudere) {
      const to: AppointmentStatus = a.status === 'IN_PROGRESS' ? 'COMPLETED' : 'NO_SHOW';
      const now = this.deps.clock.nowIso();
      const patch: Partial<Appointment> =
        to === 'COMPLETED'
          ? { completedAt: now, autoClosedAt: now, autoCloseConfirmedAt: null }
          : { noShowAt: now };
      const aggiornata = await this.apply(a, to, patch, a.version, ctx);
      if (!aggiornata.ok) {
        nonRiuscite.push(a.code);
        this.logger.warn(`chiusura giornata: pratica ${a.code} non chiusa`, {
          appointmentId: a.id,
          errore: aggiornata.error.code,
        });
        continue;
      }
      if (to === 'NO_SHOW') {
        noShow.push(a.code);
        // Stesso percorso del no-show segnato a mano: coda di uscita e tentativo di invio.
        await this.deps.crmNotifier.notifyNoShow(
          aggiornata.value,
          CLOSE_DAY_NO_SHOW_REASON,
          ctx.correlationId ?? this.deps.ids.next(),
        );
      } else {
        autoClosed.push(a.code);
      }
    }

    this.deps.eventBus.publish({
      id: this.deps.ids.next(),
      occurredAt: this.deps.clock.nowIso(),
      correlationId: ctx.correlationId ?? this.deps.ids.next(),
      actor:
        ctx.actorKind === 'SYSTEM'
          ? { kind: 'SYSTEM', id: null }
          : { kind: 'OPERATOR', id: ctx.operatorId },
      type: 'BUSINESS_DAY_CLOSED',
      businessDate,
      noShowCount: noShow.length,
      autoClosedCount: autoClosed.length,
    });
    this.logger.info(`giornata ${businessDate} chiusa`, {
      assenti: noShow.length,
      chiuseDUfficio: autoClosed.length,
      nonRiuscite: nonRiuscite.length,
    });

    return ok({
      businessDate,
      noShow,
      autoClosed,
      failed: nonRiuscite,
      alreadyClosed: tutte.length - daChiudere.length,
    });
  }

  /**
   * Riapre una pratica completata per errore (o chiusa d'ufficio): COMPLETED → IN_PROGRESS in
   * carico a chi la riapre, con uno sportello libero se c'è. La presa in carico originale resta
   * scritta; la chiusura viene cancellata, così il flag "da confermare" sparisce e il check-in
   * si può rifare. Solo nella giornata corrente: ieri non si riapre.
   */
  async reopenCompleted(
    input: TransitionInput,
    ctx: ActionContext,
  ): Promise<Result<Appointment, DomainError>> {
    const current = await this.load(input.appointmentId);
    if (!current.ok) {
      return current;
    }
    const a = current.value;
    if (a.status !== 'COMPLETED') {
      return err(
        domainError('INVALID_TRANSITION', 'Si può riaprire solo una pratica completata.', {
          from: a.status,
        }),
      );
    }
    const transition = assertTransition(a.status, 'IN_PROGRESS');
    if (!transition.ok) {
      return transition;
    }
    if (a.businessDate !== this.deps.clock.today()) {
      return err(
        domainError(
          'INVALID_TRANSITION',
          'Si può riaprire solo una pratica della giornata corrente.',
          {
            businessDate: a.businessDate,
          },
        ),
      );
    }
    const bay = await this.chooseBay(a, null, ctx.workstationId);
    if (!bay.ok) {
      return bay;
    }
    return this.apply(
      a,
      'IN_PROGRESS',
      {
        bayId: bay.value,
        operatorId: ctx.operatorId,
        takenAt: a.takenAt ?? this.deps.clock.nowIso(),
        completedAt: null,
        autoClosedAt: null,
        autoCloseConfirmedAt: null,
      },
      input.expectedVersion,
      ctx,
    );
  }

  /**
   * Conferma una chiusura d'ufficio: il responsabile dice che il veicolo era stato accettato
   * davvero. Nessun cambio di stato, solo il flag; la consegna al CRM la fa chi conosce le foto
   * (`InspectionService.confirmAutoClosed`).
   */
  async confirmAutoClose(
    input: TransitionInput,
    ctx: ActionContext,
  ): Promise<Result<Appointment, DomainError>> {
    const current = await this.load(input.appointmentId);
    if (!current.ok) {
      return current;
    }
    const a = current.value;
    if (!isAutoClosedPending(a)) {
      return err(
        domainError('VALIDATION', "La pratica non è una chiusura d'ufficio da confermare.", {
          status: a.status,
        }),
      );
    }
    const updated = await this.deps.appointments.update(
      { ...a, autoCloseConfirmedAt: this.deps.clock.nowIso() },
      input.expectedVersion,
    );
    if (!updated.ok) {
      return updated;
    }
    this.logger.info(`pratica ${a.code}: chiusura d'ufficio confermata`, {
      appointmentId: a.id,
      operatorId: ctx.operatorId,
    });
    return ok(updated.value);
  }

  /**
   * "Riattiva / Arrivato in ritardo": un cliente segnato assente si presenta. NO_SHOW → WAITING
   * con l'orario atteso spostato ad adesso, così viene servito dopo i puntuali già presenti e
   * prima di chi è atteso più tardi; il codice non cambia e il "segnato assente" resta nella
   * cronologia. Il lead del BDC si chiude da solo: nessuno deve richiamare chi è già al banco.
   */
  async reactivate(
    input: TransitionInput,
    ctx: ActionContext,
  ): Promise<Result<Appointment, DomainError>> {
    const current = await this.load(input.appointmentId);
    if (!current.ok) {
      return current;
    }
    const a = current.value;
    if (a.status !== 'NO_SHOW') {
      return err(
        domainError('INVALID_TRANSITION', 'Si può riattivare solo un cliente segnato assente.', {
          from: a.status,
        }),
      );
    }
    const transition = assertTransition(a.status, 'WAITING');
    if (!transition.ok) {
      return transition;
    }
    const riattivata = await this.apply(
      a,
      'WAITING',
      { rescheduledAt: this.deps.clock.nowIso(), skippedAt: null },
      input.expectedVersion,
      ctx,
    );
    if (!riattivata.ok) {
      return riattivata;
    }
    await this.deps.crmNotifier.resolveNoShow(
      riattivata.value,
      ctx.operatorId,
      'Cliente arrivato in ritardo: rimesso in coda, nessun ricontatto necessario.',
    );
    return riattivata;
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
    // La regola vive nel dominio (`queue-position.ts`): la stessa che usa la policy dei
    // messaggi per dire al cliente che il suo turno si avvicina.
    return countAheadInSameDesk(appointment, inQueue, desks);
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
          domainError('VALIDATION', 'Sportello sconosciuto o non attivo.', { bayId: requested }),
        );
      }
      if (slot.appointment !== null && slot.appointment.id !== a.id) {
        return err(
          domainError(
            'BAY_BUSY',
            `Lo sportello ${slot.bay.code} è occupato dalla pratica ${slot.appointment.code}.`,
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
      this.logger.warn('nessuno sportello libero: presa in carico senza sportello', {
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
      actor:
        ctx.actorKind === 'SYSTEM'
          ? { kind: 'SYSTEM', id: null }
          : { kind: 'OPERATOR', id: ctx.operatorId },
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

/** La frase dell'anomalia dei salti, come la legge il BDC: cosa è successo e cosa fare. */
export function excessiveSkipsDescription(skipCount: number): string {
  return `Cliente saltato ${skipCount} volte - Verificare presenza`;
}
