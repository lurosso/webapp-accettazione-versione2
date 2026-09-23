// Temporizzatore delle riprove dei messaggi al cliente: ogni minuto ritenta i messaggi falliti per
// un problema temporaneo la cui attesa è scaduta (1, 5, 15 minuti), poi li lascia a una persona.
//
// Stesso schema del temporizzatore dei rinvii al CRM: un `setInterval` nel processo, una passata
// alla volta, un guasto che non spegne il timer. Si disattiva con NOTIFICATION_RETRY_ENABLED=false
// (e non parte con MESSAGING_STANDBY=true): i messaggi falliti restano allora nella schermata
// Comunicazioni con il pulsante «Riprova».
import { NOTIFICATION_DRAIN_BATCH, NOTIFICATION_DRAIN_INTERVAL_MS } from '@/config/constants';
import type { ILogger } from '@/services/interfaces/ILogger';
import type { NotificationOrchestrator } from './NotificationOrchestrator';

export interface NotificationRetrySchedulerDeps {
  readonly orchestrator: NotificationOrchestrator;
  readonly logger: ILogger;
  /** Intervallo del tick in ms (default 60 s). */
  readonly tickMs?: number;
  /** Quanti messaggi per passata (default 20). */
  readonly batchSize?: number;
}

export class NotificationRetryScheduler {
  private readonly logger: ILogger;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(private readonly deps: NotificationRetrySchedulerDeps) {
    this.logger = deps.logger.child('[Notifications][Retry]');
  }

  /** Avvia il timer (idempotente) ed esegue subito una passata. Restituisce lo stop. */
  start(): () => void {
    if (this.timer === null) {
      this.timer = setInterval(() => {
        void this.tick();
      }, this.deps.tickMs ?? NOTIFICATION_DRAIN_INTERVAL_MS);
      this.logger.info('avviato', {
        ogniMs: this.deps.tickMs ?? NOTIFICATION_DRAIN_INTERVAL_MS,
        perPassata: this.deps.batchSize ?? NOTIFICATION_DRAIN_BATCH,
      });
      void this.tick();
    }
    return () => this.stop();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Una passata; se la precedente è ancora in corso questa si salta. */
  async tick(): Promise<void> {
    if (this.ticking) {
      return;
    }
    this.ticking = true;
    try {
      await this.deps.orchestrator.retryDue(this.deps.batchSize ?? NOTIFICATION_DRAIN_BATCH);
    } catch (cause) {
      this.logger.error('passata non riuscita', {
        message: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      this.ticking = false;
    }
  }
}
