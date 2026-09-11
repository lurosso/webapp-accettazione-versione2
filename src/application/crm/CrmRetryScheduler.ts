// Temporizzatore dei rinvii verso il CRM (modulo F): ogni minuto guarda se ci sono eventi la cui
// attesa è scaduta e prova a consegnarli.
//
// È volutamente minimale: un `setInterval` nel processo dell'applicazione, senza code esterne né
// worker separati. In un'officina con un solo server è la soluzione proporzionata; quando servirà
// una macchina dedicata basterà spegnere questo temporizzatore (`CRM_RETRY_ENABLED=false`) e far
// chiamare da un cron esterno l'endpoint `/api/v1/system/cron/crm-retry`, che fa esattamente le
// stesse cose. La coda regge entrambe le strade insieme, perché ogni evento è idempotente.
import { CRM_DRAIN_BATCH, CRM_DRAIN_INTERVAL_MS } from '@/config/constants';
import type { ILogger } from '@/services/interfaces/ILogger';
import type { CrmNotifier } from './CrmNotifier';

export interface CrmRetrySchedulerDeps {
  readonly notifier: CrmNotifier;
  readonly logger: ILogger;
  /** Intervallo del tick in ms (default 60 s). */
  readonly tickMs?: number;
  /** Quanti eventi per passata (default 20). */
  readonly batchSize?: number;
}

export class CrmRetryScheduler {
  private readonly logger: ILogger;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(private readonly deps: CrmRetrySchedulerDeps) {
    this.logger = deps.logger.child('[CRM][Retry]');
  }

  /** Avvia il timer (idempotente) ed esegue subito una passata. Restituisce lo stop. */
  start(): () => void {
    if (this.timer === null) {
      this.timer = setInterval(() => {
        void this.tick();
      }, this.deps.tickMs ?? CRM_DRAIN_INTERVAL_MS);
      this.logger.info('avviato', {
        ogniMs: this.deps.tickMs ?? CRM_DRAIN_INTERVAL_MS,
        perPassata: this.deps.batchSize ?? CRM_DRAIN_BATCH,
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

  /**
   * Una passata. Se la precedente è ancora in corso (CRM lentissimo) questa viene saltata: due
   * passate sovrapposte moltiplicherebbero le chiamate proprio quando il CRM è in difficoltà.
   */
  async tick(): Promise<void> {
    if (this.ticking) {
      return;
    }
    this.ticking = true;
    try {
      await this.deps.notifier.drainDue(this.deps.batchSize ?? CRM_DRAIN_BATCH);
    } catch (cause) {
      // Un guasto qui non deve spegnere il temporizzatore: si riprova al prossimo giro.
      this.logger.error('passata non riuscita', {
        message: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      this.ticking = false;
    }
  }
}
