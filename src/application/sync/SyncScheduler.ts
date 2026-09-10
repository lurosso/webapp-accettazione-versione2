// Scheduler della sincronizzazione giornaliera: alle SYNC_HOUR_LOCAL (default 06:00, fuso
// dell'officina) esegue la sync se la giornata non ne ha ancora una; all'avvio del processo fa il
// "catch-up" (server riavviato alle 09:00 → sync immediata). Un solo timer per processo.
import type { IsoDate } from '@/domain/value-objects/iso-date';
import { localTimeHHmm } from '@/lib/dates';
import type { ISyncRunRepository } from '@/repositories/interfaces';
import type { IClock } from '@/services/interfaces/IClock';
import type { ILogger } from '@/services/interfaces/ILogger';
import type { SyncService } from './SyncService';

export interface SyncSchedulerDeps {
  readonly syncService: SyncService;
  readonly syncRuns: ISyncRunRepository;
  readonly clock: IClock;
  readonly logger: ILogger;
  /** Ora locale "HH:mm" (env SYNC_HOUR_LOCAL). */
  readonly syncHourLocal: string;
  readonly timeZone: string;
  /** Intervallo del tick in ms (default 60 s). */
  readonly tickMs?: number;
}

const DEFAULT_TICK_MS = 60_000;

export class SyncScheduler {
  private readonly logger: ILogger;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

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
      if (localTimeHHmm(now, this.deps.timeZone) < this.deps.syncHourLocal) {
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
}
