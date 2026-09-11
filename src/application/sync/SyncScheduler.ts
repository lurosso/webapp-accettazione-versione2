// Scheduler della giornata operativa: la apre e la chiude.
// - alle SYNC_HOUR_LOCAL (default 06:00, fuso dell'officina) esegue la sync se la giornata non ne
//   ha ancora una; all'avvio del processo fa il "catch-up" (server riavviato alle 09:00 → sync
//   immediata);
// - dopo BUSINESS_DAY_END_TIME (default 19:00) chiude la giornata, se è rimasto qualcosa di aperto
//   e il responsabile non l'ha già chiusa a mano.
// Un solo timer per processo. La chiusura automatica è deliberatamente prudente: una volta sola
// al giorno e solo se c'è davvero qualcosa da chiudere, perché tocca decine di pratiche e in quel
// momento non la sta guardando nessuno.
import { ACTIVE_QUEUE_STATUSES } from '@/domain/entities/appointment';
import type { IsoDate } from '@/domain/value-objects/iso-date';
import { localTimeHHmm } from '@/lib/dates';
import type { IAppointmentRepository, ISyncRunRepository } from '@/repositories/interfaces';
import type { IClock } from '@/services/interfaces/IClock';
import type { ILogger } from '@/services/interfaces/ILogger';
import { SYSTEM_ACTOR_ID, type QueueService } from '../queue/QueueService';
import type { SyncService } from './SyncService';

export interface SyncSchedulerDeps {
  readonly syncService: SyncService;
  readonly syncRuns: ISyncRunRepository;
  /** Servono alla chiusura di fine turno. */
  readonly queueService: QueueService;
  readonly appointments: IAppointmentRepository;
  readonly clock: IClock;
  readonly logger: ILogger;
  /** Ora locale "HH:mm" (env SYNC_HOUR_LOCAL). */
  readonly syncHourLocal: string;
  /** Ora locale "HH:mm" di fine turno (env BUSINESS_DAY_END_TIME). */
  readonly businessDayEndLocal: string;
  readonly timeZone: string;
  /** Intervallo del tick in ms (default 60 s). */
  readonly tickMs?: number;
}

const DEFAULT_TICK_MS = 60_000;

export class SyncScheduler {
  private readonly logger: ILogger;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  /** Giornata per cui la chiusura automatica è già stata valutata: si fa una volta sola. */
  private lastClosedDate: IsoDate | null = null;

  constructor(private readonly deps: SyncSchedulerDeps) {
    this.logger = deps.logger.child('[Scheduler]');
  }

  /** Avvia il timer (idempotente) ed esegue subito un tick di catch-up. Restituisce lo stop. */
  start(): () => void {
    if (this.timer === null) {
      this.timer = setInterval(() => {
        void this.tick('SCHEDULED');
      }, this.deps.tickMs ?? DEFAULT_TICK_MS);
      this.logger.info('avviato', {
        syncHourLocal: this.deps.syncHourLocal,
        businessDayEndLocal: this.deps.businessDayEndLocal,
        timeZone: this.deps.timeZone,
      });
      void this.tick('BOOTSTRAP');
    }
    return () => this.stop();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Un tick: se l'ora locale ha superato SYNC_HOUR_LOCAL e la giornata non ha ancora una sync,
   * la esegue. Le sync fallite NON vengono ritentate automaticamente: la dashboard mostra il
   * banner con "Riprova" (regola di fallback manuale).
   */
  async tick(trigger: 'SCHEDULED' | 'BOOTSTRAP'): Promise<void> {
    if (this.ticking) {
      return;
    }
    this.ticking = true;
    try {
      const now = this.deps.clock.now();
      const today: IsoDate = this.deps.clock.today();
      const oraLocale = localTimeHHmm(now, this.deps.timeZone);

      await this.closeBusinessDayIfDue(today, oraLocale);

      if (oraLocale < this.deps.syncHourLocal) {
        return;
      }
      const latest = await this.deps.syncRuns.findLatest(today);
      if (latest !== null) {
        return;
      }
      this.logger.info(`nessuna sync per ${today}: avvio ${trigger}`);
      await this.deps.syncService.runDailySync(today, trigger);
    } catch (error) {
      this.logger.error('tick fallito', {
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.ticking = false;
    }
  }

  /**
   * Chiusura di fine turno: una volta per giornata e solo se qualcosa è rimasto aperto. Se il
   * responsabile ha già chiuso a mano non c'è nulla da fare, e un secondo evento di chiusura
   * direbbe soltanto la stessa cosa.
   */
  private async closeBusinessDayIfDue(today: IsoDate, oraLocale: string): Promise<void> {
    if (oraLocale < this.deps.businessDayEndLocal || this.lastClosedDate === today) {
      return;
    }
    // Segnata subito: se la chiusura fallisce non si riprova a ogni minuto fino a mezzanotte.
    // Resta il pulsante del responsabile, che è la via manuale prevista.
    this.lastClosedDate = today;

    const aperte = await this.deps.appointments.listByDate(today, {
      statuses: [...ACTIVE_QUEUE_STATUSES, 'IN_PROGRESS'],
    });
    if (aperte.length === 0) {
      this.logger.info('fine turno: giornata gia chiusa', { giornata: today });
      return;
    }

    this.logger.info('fine turno: chiusura automatica', { giornata: today, aperte: aperte.length });
    const esito = await this.deps.queueService.closeBusinessDay(today, {
      operatorId: SYSTEM_ACTOR_ID,
      workstationId: null,
      correlationId: null,
      actorKind: 'SYSTEM',
    });
    if (!esito.ok) {
      this.logger.error('chiusura automatica non riuscita', { errore: esito.error.code });
      return;
    }
    this.logger.info('chiusura automatica completata', {
      assenti: esito.value.noShow.length,
      annullate: esito.value.cancelled.length,
      nonRiuscite: esito.value.failed.length,
    });
  }
}
