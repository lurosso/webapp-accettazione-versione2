// Sincronizzazione dell'agenda Infinity (le 06:00 dei requisiti): idempotente e non distruttiva.
// - nuove pratiche: codice dal CodeGenerator in ordine (orario, externalRef), poi insert;
// - esistenti in WAITING: aggiornate se cambiate; in altri stati mai toccate;
// - sparite dall'agenda o annullate: CANCELLED solo se ancora in coda (WAITING/SKIPPED);
// - agenda parziale: nessuna cancellazione per assenza. Un lock per giornata evita sync parallele.
import type { Appointment } from '@/domain/entities/appointment';
import type { SyncCounters, SyncRun, SyncTrigger } from '@/domain/entities/sync-run';
import { EMPTY_SYNC_COUNTERS } from '@/domain/entities/sync-run';
import { asAppointmentId, asSyncRunId, type OperatorId } from '@/domain/ids';
import type { IsoDate } from '@/domain/value-objects/iso-date';
import type {
  IAppointmentRepository,
  IReferenceDataRepository,
  ISyncRunRepository,
} from '@/repositories/interfaces';
import type { IInfinityService } from '@/services/interfaces/IInfinityService';
import type { IClock } from '@/services/interfaces/IClock';
import type { IEventBus } from '@/services/interfaces/IEventBus';
import type { IIdGenerator } from '@/services/interfaces/IIdGenerator';
import type { ILogger } from '@/services/interfaces/ILogger';
import { mapInfinityAgenda, type AppointmentDraft } from '@/services/mappers/infinity.mapper';
import type { NotificationOrchestrator } from '../notifications/NotificationOrchestrator';
import type { CodeGenerator } from '../queue/CodeGenerator';

export interface SyncServiceDeps {
  readonly infinity: IInfinityService;
  readonly appointments: IAppointmentRepository;
  readonly syncRuns: ISyncRunRepository;
  readonly referenceData: IReferenceDataRepository;
  readonly codeGenerator: CodeGenerator;
  readonly eventBus: IEventBus;
  readonly clock: IClock;
  readonly ids: IIdGenerator;
  readonly logger: ILogger;
  readonly timeZone: string;
  /**
   * Orchestratore dei promemoria (modulo C): dopo la sincronizzazione dell'agenda i clienti
   * appena inseriti in coda ricevono il messaggio del mattino.
   */
  readonly notifications: NotificationOrchestrator;
}

/** Timeout della chiamata a Infinity: oltre, la sync fallisce e la dashboard mostra il banner. */
const FETCH_TIMEOUT_MS = 10_000;

interface MutableCounters {
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  cancelled: number;
  rejected: number;
}

export class SyncService {
  private readonly logger: ILogger;
  /** Lock in-process per giornata: la seconda chiamata concorrente riceve la stessa SyncRun. */
  private readonly inFlight = new Map<string, Promise<SyncRun>>();

  constructor(private readonly deps: SyncServiceDeps) {
    this.logger = deps.logger.child('[Sync]');
  }

  /** Esegue (o si aggancia a) la sincronizzazione della giornata. Non lancia mai. */
  runDailySync(
    businessDate: IsoDate,
    trigger: SyncTrigger,
    operatorId: OperatorId | null = null,
  ): Promise<SyncRun> {
    const running = this.inFlight.get(businessDate);
    if (running !== undefined) {
      return running;
    }
    const promise = this.execute(businessDate, trigger, operatorId).finally(() => {
      this.inFlight.delete(businessDate);
    });
    this.inFlight.set(businessDate, promise);
    return promise;
  }

  /** Ultima sincronizzazione della giornata (qualunque esito), per il banner della dashboard. */
  getLatestRun(businessDate: IsoDate): Promise<SyncRun | null> {
    return this.deps.syncRuns.findLatest(businessDate);
  }

  private async execute(
    businessDate: IsoDate,
    trigger: SyncTrigger,
    operatorId: OperatorId | null,
  ): Promise<SyncRun> {
    const correlationId = this.deps.ids.next();
    let run: SyncRun = await this.deps.syncRuns.insert({
      id: this.deps.ids.nextAs(asSyncRunId),
      businessDate,
      trigger,
      status: 'RUNNING',
      startedAt: this.deps.clock.nowIso(),
      finishedAt: null,
      counters: EMPTY_SYNC_COUNTERS,
      errorCode: null,
      errorMessage: null,
      correlationId,
      triggeredByOperatorId: operatorId,
    });
    this.logger.info(`sync ${trigger} avviata per ${businessDate}`, { correlationId });

    try {
      const fetched = await this.deps.infinity.fetchDailyAgenda(businessDate, {
        timeoutMs: FETCH_TIMEOUT_MS,
        correlationId,
      });
      if (!fetched.ok) {
        return this.finish(
          run,
          'FAILED',
          EMPTY_SYNC_COUNTERS,
          fetched.error.code,
          fetched.error.message,
        );
      }
      const agenda = fetched.value;
      const [brands, desks] = await Promise.all([
        this.deps.referenceData.listBrands(),
        this.deps.referenceData.listDesks(),
      ]);
      const mapped = mapInfinityAgenda(agenda, {
        brands,
        desks,
        ids: this.deps.ids,
        timeZone: this.deps.timeZone,
      });
      if (!mapped.ok) {
        return this.finish(
          run,
          'FAILED',
          EMPTY_SYNC_COUNTERS,
          mapped.error.code,
          mapped.error.message,
        );
      }
      const { counters, created } = await this.reconcile(
        businessDate,
        run,
        mapped.value.drafts,
        agenda.partial,
      );
      const rejected = counters.rejected + mapped.value.rejected.length;
      const finalCounters: SyncCounters = {
        ...counters,
        fetched: agenda.appointments.length,
        rejected,
      };
      const status = agenda.partial || rejected > 0 ? 'PARTIAL' : 'SUCCESS';
      const message =
        status === 'PARTIAL'
          ? agenda.partial
            ? 'Agenda parziale ricevuta da Infinity: nessuna pratica assente è stata annullata.'
            : `${rejected} appuntamenti scartati per dati non validi.`
          : null;
      run = await this.finish(run, status, finalCounters, null, message);

      // Promemoria del mattino alle pratiche appena entrate in coda. NON si attende l'esito:
      // con decine di clienti l'invio dura secondi e la coda è già utilizzabile. Gli esiti
      // finiscono nei log e sul job di ogni notifica, visibili poi dalla dashboard.
      if (created.length > 0) {
        void this.deps.notifications
          .sendMorningReminders({ appointments: created, brands, correlationId })
          .catch((cause: unknown) => {
            this.logger.error('invio dei promemoria interrotto', {
              correlationId,
              message: cause instanceof Error ? cause.message : String(cause),
            });
          });
      }
      return run;
    } catch (error) {
      // Rete di sicurezza: qualunque eccezione inattesa diventa una SyncRun FAILED, mai un crash.
      const message = error instanceof Error ? error.message : 'Errore inatteso durante la sync.';
      this.logger.error('sync interrotta da eccezione', { correlationId, message });
      return this.finish(run, 'FAILED', EMPTY_SYNC_COUNTERS, 'INTERNAL', message);
    }
  }

  private async reconcile(
    businessDate: IsoDate,
    run: SyncRun,
    drafts: readonly AppointmentDraft[],
    partial: boolean,
  ): Promise<{ readonly counters: SyncCounters; readonly created: readonly Appointment[] }> {
    const counters: MutableCounters = { ...EMPTY_SYNC_COUNTERS };
    // Le pratiche appena create servono a chi invia i promemoria: solo a loro va il messaggio.
    const created: Appointment[] = [];
    const existing = await this.deps.appointments.listByDate(businessDate, {
      includeCancelled: true,
    });
    const byExternalRef = new Map(
      existing.flatMap((a) => (a.externalRef === null ? [] : [[a.externalRef, a] as const])),
    );
    const seen = new Set<string>();

    // Ordinamento stabile: la prima prenotazione della giornata riceve F001.
    const ordered = [...drafts].sort((x, y) =>
      x.scheduledAt === y.scheduledAt
        ? x.externalRef.localeCompare(y.externalRef)
        : x.scheduledAt < y.scheduledAt
          ? -1
          : 1,
    );

    for (const draft of ordered) {
      seen.add(draft.externalRef);
      const current = byExternalRef.get(draft.externalRef);
      if (current === undefined) {
        if (draft.cancelled) {
          continue; // annullata prima ancora di entrare in coda: non si crea
        }
        const inserita = await this.create(draft, run);
        if (inserita !== null) {
          counters.created += 1;
          created.push(inserita);
        } else {
          counters.rejected += 1;
        }
        continue;
      }
      if (draft.cancelled) {
        if (await this.cancel(current, run)) {
          counters.cancelled += 1;
        } else {
          counters.unchanged += 1;
        }
        continue;
      }
      if (current.status === 'WAITING' && this.hasChanges(current, draft)) {
        const updated = await this.deps.appointments.update(
          {
            ...current,
            scheduledAt: draft.scheduledAt,
            deskId: draft.deskId ?? current.deskId,
            customer: { ...draft.customer, id: current.customer.id },
            vehicle: { ...draft.vehicle, id: current.vehicle.id },
            serviceDescription: draft.serviceDescription,
            lastSyncRunId: run.id,
          },
          current.version,
        );
        if (updated.ok) {
          counters.updated += 1;
        } else {
          counters.unchanged += 1; // modificata nel frattempo da un operatore: vince l'officina
        }
        continue;
      }
      counters.unchanged += 1;
    }

    // Pratiche Infinity sparite dall'agenda: annullate solo se ancora in coda e agenda completa.
    if (!partial) {
      for (const a of existing) {
        if (a.source === 'INFINITY' && a.externalRef !== null && !seen.has(a.externalRef)) {
          if (await this.cancel(a, run)) {
            counters.cancelled += 1;
          }
        }
      }
    }
    return { counters, created };
  }

  private async create(draft: AppointmentDraft, run: SyncRun): Promise<Appointment | null> {
    const assigned = await this.deps.codeGenerator.next(draft.businessDate, draft.brand);
    const now = this.deps.clock.nowIso();
    const appointment: Appointment = {
      id: this.deps.ids.nextAs(asAppointmentId),
      externalRef: draft.externalRef,
      source: 'INFINITY',
      businessDate: draft.businessDate,
      scheduledAt: draft.scheduledAt,
      rescheduledAt: null,
      code: assigned.code,
      sequence: assigned.sequence,
      brandId: draft.brand.id,
      deskId: draft.deskId,
      customer: draft.customer,
      vehicle: draft.vehicle,
      serviceDescription: draft.serviceDescription,
      status: 'WAITING',
      bayId: null,
      operatorId: null,
      skipCount: 0,
      notes: null,
      takenAt: null,
      skippedAt: null,
      completedAt: null,
      noShowAt: null,
      cancelledAt: null,
      lastSyncRunId: run.id,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    const inserted = await this.deps.appointments.insert(appointment);
    if (!inserted.ok) {
      this.logger.warn('pratica scartata dalla sync', {
        externalRef: draft.externalRef,
        error: inserted.error.message,
      });
      return null;
    }
    this.deps.eventBus.publish({
      id: this.deps.ids.next(),
      occurredAt: now,
      correlationId: run.correlationId,
      actor: { kind: 'SYSTEM', id: null },
      type: 'APPOINTMENT_CREATED',
      appointmentId: appointment.id,
      source: 'INFINITY',
    });
    return inserted.value;
  }

  /** CANCELLED solo da WAITING/SKIPPED: una pratica in carico o completata non si tocca. */
  private async cancel(a: Appointment, run: SyncRun): Promise<boolean> {
    if (a.status !== 'WAITING' && a.status !== 'SKIPPED') {
      return false;
    }
    const updated = await this.deps.appointments.update(
      { ...a, status: 'CANCELLED', cancelledAt: this.deps.clock.nowIso(), lastSyncRunId: run.id },
      a.version,
    );
    if (updated.ok) {
      this.deps.eventBus.publish({
        id: this.deps.ids.next(),
        occurredAt: this.deps.clock.nowIso(),
        correlationId: run.correlationId,
        actor: { kind: 'SYSTEM', id: null },
        type: 'APPOINTMENT_STATUS_CHANGED',
        appointmentId: a.id,
        from: a.status,
        to: 'CANCELLED',
        bayId: null,
      });
    }
    return updated.ok;
  }

  private hasChanges(current: Appointment, draft: AppointmentDraft): boolean {
    return (
      // L'orario dell'agenda si aggiorna liberamente: `rescheduledAt`, deciso in officina per un
      // cliente arrivato in ritardo, resta comunque valido e continua a prevalere.
      current.scheduledAt !== draft.scheduledAt ||
      current.customer.firstName !== draft.customer.firstName ||
      current.customer.lastName !== draft.customer.lastName ||
      current.customer.phone !== draft.customer.phone ||
      current.vehicle.plate !== draft.vehicle.plate ||
      current.vehicle.model !== draft.vehicle.model ||
      current.serviceDescription !== draft.serviceDescription ||
      (draft.deskId !== null && current.deskId !== draft.deskId)
    );
  }

  private async finish(
    run: SyncRun,
    status: SyncRun['status'],
    counters: SyncCounters,
    errorCode: string | null,
    errorMessage: string | null,
  ): Promise<SyncRun> {
    const finished: SyncRun = {
      ...run,
      status,
      counters,
      errorCode,
      errorMessage,
      finishedAt: this.deps.clock.nowIso(),
    };
    const saved = await this.deps.syncRuns.update(finished);
    this.deps.eventBus.publish({
      id: this.deps.ids.next(),
      occurredAt: saved.finishedAt ?? this.deps.clock.nowIso(),
      correlationId: saved.correlationId,
      actor: { kind: 'SYSTEM', id: null },
      type: 'SYNC_RUN_FINISHED',
      syncRunId: saved.id,
      status: saved.status,
    });
    const log =
      status === 'FAILED'
        ? this.logger.error.bind(this.logger)
        : this.logger.info.bind(this.logger);
    log(`sync ${status} per ${saved.businessDate}`, { ...counters, errorCode, errorMessage });
    return saved;
  }
}
