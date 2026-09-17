// Portale cliente (modulo B): lo stato della pratica visto dal telefono e l'unica azione concessa
// al cliente, "sto arrivando in ritardo". Senza login: si entra con la targa (QR in officina) o
// con il token unico del link WhatsApp (`portal-token.ts`).
//
// Regole:
// - la pratica mostrata è quella di oggi con quella targa (aperta, altrimenti l'ultima chiusa);
//   se oggi non c'è nulla si guarda ieri, così chi apre il link il giorno dopo legge "conclusa"
//   invece di "targa non trovata";
// - una pratica chiusa da oltre PORTAL_CONCLUDED_AFTER_HOURS, o di una giornata passata, è
//   `expired`: il portale mostra solo la chiusura cortese, niente coda né pulsanti;
// - la segnalazione di ritardo vale solo per chi è ancora in coda oggi, sposta l'arrivo atteso
//   di N minuti (non l'ordine della coda), pubblica un evento con attore CUSTOMER e ha un tempo
//   minimo fra due tocchi. Nessun dato personale esce da qui.
import {
  CUSTOMER_LATE_NOTICE_COOLDOWN_MINUTES,
  CUSTOMER_LATE_NOTICE_MINUTES,
  PORTAL_CONCLUDED_AFTER_HOURS,
  SITE_NAME,
} from '@/config/constants';
import {
  ACTIVE_QUEUE_STATUSES,
  effectiveScheduleTime,
  isInQueue,
  type Appointment,
  type AppointmentStatus,
} from '@/domain/entities/appointment';
import type { Desk } from '@/domain/entities/desk';
import { domainError, type DomainError } from '@/domain/errors';
import { countAheadInSameDesk, deskKeyOf } from '@/domain/queue-position';
import type { PortalStage, PortalStatusView } from '@/domain/read-models';
import { err, ok, type Result } from '@/domain/result';
import type { IsoDate, IsoDateTime } from '@/domain/value-objects/iso-date';
import { parsePlate, type PlateNumber } from '@/domain/value-objects/plate';
import { addDays, addMinutes } from '@/lib/dates';
import type {
  IAppointmentRepository,
  IOperatorRepository,
  IReferenceDataRepository,
} from '@/repositories/interfaces';
import type { IClock } from '@/services/interfaces/IClock';
import type { IEventBus } from '@/services/interfaces/IEventBus';
import type { IIdGenerator } from '@/services/interfaces/IIdGenerator';
import type { ILogger } from '@/services/interfaces/ILogger';
import type { PortalTokenFactory } from './portal-token';

/** Esito di "sono arrivato": lo stato aggiornato e se l'ora è stata registrata adesso. */
export interface PortalArrival {
  readonly status: PortalStatusView;
  /** False quando l'arrivo era già registrato o la pratica non è più in coda. */
  readonly registered: boolean;
  /** La pratica com'è ora: serve a chi deve mandare la conferma su WhatsApp. */
  readonly appointment: Appointment;
}

/** Come il cliente identifica la propria pratica: targa (QR) e/o token del link. */
export interface PortalLookup {
  readonly plate?: string | null;
  readonly token?: string | null;
}

export interface CustomerPortalServiceDeps {
  readonly appointments: IAppointmentRepository;
  readonly referenceData: IReferenceDataRepository;
  readonly operators: IOperatorRepository;
  readonly eventBus: IEventBus;
  readonly clock: IClock;
  readonly ids: IIdGenerator;
  readonly logger: ILogger;
  /** Null nei contesti senza segreto: si accede solo per targa. */
  readonly tokens: PortalTokenFactory | null;
  readonly siteName?: string;
  readonly lateNoticeMinutes?: number;
  readonly lateNoticeCooldownMinutes?: number;
  readonly concludedAfterHours?: number;
}

/** Tappa del percorso per stato della pratica (regola unica, usata anche dai test di rendering). */
export function portalStageOf(status: AppointmentStatus): PortalStage {
  switch (status) {
    case 'IN_PROGRESS':
      return 2;
    case 'COMPLETED':
      return 3;
    default:
      return 1;
  }
}

export class CustomerPortalService {
  private readonly logger: ILogger;

  constructor(private readonly deps: CustomerPortalServiceDeps) {
    this.logger = deps.logger.child('[Portale]');
  }

  /** Stato della pratica per il portale. */
  async getStatus(lookup: PortalLookup): Promise<Result<PortalStatusView, DomainError>> {
    const trovata = await this.resolve(lookup);
    if (!trovata.ok) {
      return trovata;
    }
    return ok(await this.toView(trovata.value));
  }

  /**
   * "Sto arrivando in ritardo (+N min)": il cliente avvisa l'accettazione dal telefono. La pratica
   * resta in coda al suo posto; l'arrivo atteso si sposta e la dashboard mostra l'avviso ambra.
   */
  async reportDelay(
    lookup: PortalLookup,
    minutes: number = this.deps.lateNoticeMinutes ?? CUSTOMER_LATE_NOTICE_MINUTES,
  ): Promise<Result<PortalStatusView, DomainError>> {
    const trovata = await this.resolve(lookup);
    if (!trovata.ok) {
      return trovata;
    }
    const a = trovata.value;
    const today = this.deps.clock.today();
    if (!isInQueue(a.status) || a.businessDate !== today) {
      return err(
        domainError(
          'INVALID_TRANSITION',
          'La segnalazione di ritardo è possibile solo mentre la pratica è in attesa oggi.',
          { status: a.status, businessDate: a.businessDate },
        ),
      );
    }
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 120) {
      return err(
        domainError('VALIDATION', 'Il ritardo va indicato in minuti, fra 5 e 120.', { minutes }),
      );
    }
    const now = this.deps.clock.nowIso();
    if (!this.canReportDelay(a, now)) {
      // Doppio tocco entro il tempo minimo: nessun errore, si restituisce lo stato com'è.
      return ok(await this.toView(a));
    }
    // L'arrivo dichiarato parte dall'orario atteso (se è ancora futuro) o da adesso.
    const base = effectiveScheduleTime(a) > now ? effectiveScheduleTime(a) : now;
    const etaAt = addMinutes(base, minutes);
    const updated = await this.deps.appointments.update(
      { ...a, customerLateNoticeAt: now, customerEtaAt: etaAt },
      a.version,
    );
    if (!updated.ok) {
      return updated;
    }
    this.deps.eventBus.publish({
      id: this.deps.ids.next(),
      occurredAt: now,
      correlationId: this.deps.ids.next(),
      actor: { kind: 'CUSTOMER', id: null },
      type: 'CUSTOMER_LATE_NOTICE',
      appointmentId: a.id,
      minutes,
      etaAt,
    });
    this.logger.info(`pratica ${a.code}: il cliente avvisa un ritardo di ${minutes} minuti`, {
      appointmentId: a.id,
      etaAt,
    });
    return ok(await this.toView(updated.value));
  }

  /**
   * "Sono arrivato": il cliente dichiara di essere in officina, dalla pagina di tracciamento o
   * rispondendo al messaggio WhatsApp (`channel`). Si annota l'ora e basta: la pratica resta al
   * suo posto in coda, perché l'ordine lo decidono l'orario di prenotazione e l'accettatore, non
   * chi tocca il pulsante per primo. All'accettazione serve sapere chi è in sala.
   *
   * Idempotente per costruzione: il secondo tocco (rete lenta, pulsante premuto due volte, prima
   * la pagina e poi WhatsApp) non sposta l'ora già registrata e non pubblica un secondo evento.
   * Fuori dalla coda — già chiamato allo sportello, concluso, assente — non c'è nulla da
   * registrare e lo stato torna com'è: non è un errore, è un tocco arrivato tardi.
   */
  async registerArrival(
    lookup: PortalLookup,
    channel: 'PORTAL' | 'WHATSAPP' = 'PORTAL',
  ): Promise<Result<PortalArrival, DomainError>> {
    const trovata = await this.resolve(lookup);
    if (!trovata.ok) {
      return trovata;
    }
    const a = trovata.value;
    const today = this.deps.clock.today();
    if (!isInQueue(a.status) || a.businessDate !== today || a.customerArrivedAt !== null) {
      return ok({ status: await this.toView(a), registered: false, appointment: a });
    }
    const now = this.deps.clock.nowIso();
    const updated = await this.deps.appointments.update(
      { ...a, customerArrivedAt: now },
      a.version,
    );
    if (!updated.ok) {
      return updated;
    }
    this.deps.eventBus.publish({
      id: this.deps.ids.next(),
      occurredAt: now,
      correlationId: this.deps.ids.next(),
      actor: { kind: 'CUSTOMER', id: null },
      type: 'CUSTOMER_ARRIVED',
      appointmentId: a.id,
      code: a.code,
      channel,
    });
    this.logger.info(`pratica ${a.code}: il cliente è arrivato in officina`, {
      appointmentId: a.id,
      channel,
    });
    return ok({
      status: await this.toView(updated.value),
      registered: true,
      appointment: updated.value,
    });
  }

  // --- interni ---------------------------------------------------------------------------

  private async resolve(lookup: PortalLookup): Promise<Result<Appointment, DomainError>> {
    const today = this.deps.clock.today();
    const yesterday = addDays(today, -1);
    const token = lookup.token?.trim() ?? '';
    const rawPlate = lookup.plate?.trim() ?? '';

    if (token !== '' && this.deps.tokens !== null) {
      const tokens = this.deps.tokens;
      const candidate = [
        ...(await this.deps.appointments.listByDate(today, { includeCancelled: true })),
        ...(await this.deps.appointments.listByDate(yesterday, { includeCancelled: true })),
      ].find((a) => tokens.matches(a.id, token));
      if (candidate !== undefined) {
        return ok(candidate);
      }
      if (rawPlate === '') {
        return err(
          domainError('NOT_FOUND', 'Il link non è più valido: rivolgiti allo sportello.', {}),
        );
      }
      // Token sconosciuto ma targa presente: si prosegue per targa, come dal QR.
    }

    if (rawPlate === '') {
      return err(domainError('VALIDATION', 'Indicare la targa del veicolo.', {}));
    }
    const plate = parsePlate(rawPlate);
    if (!plate.ok) {
      return plate;
    }
    const oggi = pickForCustomer(await this.deps.appointments.findByPlate(plate.value, today));
    if (oggi !== null) {
      return ok(oggi);
    }
    const ieri = pickForCustomer(await this.deps.appointments.findByPlate(plate.value, yesterday));
    if (ieri !== null) {
      return ok(ieri);
    }
    return err(
      domainError(
        'NOT_FOUND',
        "Targa non trovata nell'agenda di oggi. Rivolgiti allo sportello dell'accettazione.",
        { plate: plate.value },
      ),
    );
  }

  private canReportDelay(a: Appointment, nowIso: IsoDateTime): boolean {
    if (!isInQueue(a.status) || a.businessDate !== this.deps.clock.today()) {
      return false;
    }
    if (a.customerLateNoticeAt === null) {
      return true;
    }
    const cooldownMs =
      (this.deps.lateNoticeCooldownMinutes ?? CUSTOMER_LATE_NOTICE_COOLDOWN_MINUTES) * 60_000;
    return new Date(nowIso).getTime() - new Date(a.customerLateNoticeAt).getTime() >= cooldownMs;
  }

  private isExpired(a: Appointment, nowIso: IsoDateTime, today: IsoDate): boolean {
    const aperta = isInQueue(a.status) || a.status === 'IN_PROGRESS';
    if (aperta) {
      return a.businessDate < today;
    }
    const conclusa = concludedAt(a);
    if (conclusa === null) {
      return a.businessDate < today;
    }
    const soglia = (this.deps.concludedAfterHours ?? PORTAL_CONCLUDED_AFTER_HOURS) * 3_600_000;
    return new Date(nowIso).getTime() - new Date(conclusa).getTime() >= soglia;
  }

  private async toView(a: Appointment): Promise<PortalStatusView> {
    const now = this.deps.clock.nowIso();
    const today = this.deps.clock.today();
    const [inQueue, desks, brands, bay, operator] = await Promise.all([
      isInQueue(a.status)
        ? this.deps.appointments.listByDate(a.businessDate, {
            statuses: [...ACTIVE_QUEUE_STATUSES],
          })
        : Promise.resolve([] as readonly Appointment[]),
      this.deps.referenceData.listDesks(),
      this.deps.referenceData.listBrands(),
      a.bayId === null ? Promise.resolve(null) : this.deps.referenceData.findBayById(a.bayId),
      a.operatorId === null ? Promise.resolve(null) : this.deps.operators.findById(a.operatorId),
    ]);
    const desk = deskOf(a, desks);
    const expired = this.isExpired(a, now, today);
    return {
      code: a.code,
      status: a.status,
      aheadCount: isInQueue(a.status) ? countAheadInSameDesk(a, inQueue, desks) : 0,
      // "Sei il numero N in attesa": i clienti davanti più se stesso. Fuori dalla coda non ha
      // senso una posizione, e mostrarne una vecchia confonderebbe chi è già allo sportello.
      queuePosition: isInQueue(a.status) ? countAheadInSameDesk(a, inQueue, desks) + 1 : null,
      arrivedAt: a.customerArrivedAt,
      startedAt: a.takenAt,
      // Lettera dello sportello: è l'indicazione che il cliente deve seguire in sala.
      bayCode: a.status === 'IN_PROGRESS' ? (bay?.code ?? null) : null,
      brandCode: brands.find((b) => b.id === a.brandId)?.code ?? '',
      scheduledAt: a.scheduledAt,
      updatedAt: a.updatedAt,
      businessDate: a.businessDate,
      plate: a.vehicle.plate,
      stage: portalStageOf(a.status),
      expectedTime: effectiveScheduleTime(a),
      siteName: this.deps.siteName ?? SITE_NAME,
      deskName: desk?.name ?? null,
      operatorName: operator?.displayName ?? null,
      lateNotice:
        a.customerLateNoticeAt !== null && a.customerEtaAt !== null
          ? {
              at: a.customerLateNoticeAt,
              etaAt: a.customerEtaAt,
              minutes: Math.max(
                0,
                Math.round(
                  (new Date(a.customerEtaAt).getTime() -
                    new Date(
                      effectiveScheduleTime(a) > a.customerLateNoticeAt
                        ? effectiveScheduleTime(a)
                        : a.customerLateNoticeAt,
                    ).getTime()) /
                    60_000,
                ),
              ),
            }
          : null,
      canReportDelay: !expired && this.canReportDelay(a, now),
      expired,
      concludedAt: concludedAt(a),
    };
  }
}

/** Fra le pratiche con la stessa targa nella giornata: la prima aperta, altrimenti l'ultima chiusa. */
function pickForCustomer(found: readonly Appointment[]): Appointment | null {
  const open = found.find((a) => isInQueue(a.status) || a.status === 'IN_PROGRESS');
  return open ?? found.at(-1) ?? null;
}

/** Sportello della pratica: quello dell'agenda, altrimenti quello che serve il marchio. */
function deskOf(a: Appointment, desks: readonly Desk[]): Desk | null {
  const key = deskKeyOf(a, desks);
  return desks.find((d) => d.id === key) ?? null;
}

/** Istante di chiusura della pratica, qualunque sia il modo in cui si è chiusa. */
function concludedAt(a: Appointment): IsoDateTime | null {
  switch (a.status) {
    case 'COMPLETED':
      return a.completedAt ?? a.updatedAt;
    case 'CANCELLED':
      return a.cancelledAt ?? a.updatedAt;
    case 'NO_SHOW':
      return a.noShowAt ?? a.updatedAt;
    default:
      return null;
  }
}

export { type PlateNumber };
