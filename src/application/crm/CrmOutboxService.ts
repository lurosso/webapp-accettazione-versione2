// Vista tecnica della coda di uscita verso il CRM (modulo F), per il pannello Sistema.
//
// È il gemello tecnico del cruscotto BDC: gli stessi eventi, ma letti dalla parte di chi tiene in
// piedi il sistema. Il BDC vuole sapere chi richiamare; qui si vuole sapere se il CRM sta
// ricevendo, quante volte abbiamo riprovato e con che errore. Nessun dato del cliente in questa
// vista: bastano codice pratica, stato e diagnostica.
import type { CrmOutboxEvent, CrmOutboxStatus } from '@/domain/entities/crm-outbox-event';
import type { CrmOutboxEventId } from '@/domain/ids';
import type { CrmOutboxRowView, CrmOutboxView } from '@/domain/read-models';
import type { ICrmOutboxRepository } from '@/repositories/interfaces';
import type { ILogger } from '@/services/interfaces/ILogger';
import type { CrmDelivery, CrmNotifier } from './CrmNotifier';

export interface CrmOutboxServiceDeps {
  readonly outbox: ICrmOutboxRepository;
  readonly notifier: CrmNotifier;
  readonly logger: ILogger;
}

/** Tutti gli stati, nell'ordine in cui interessano al tecnico. */
const TUTTI: readonly CrmOutboxStatus[] = ['PENDING', 'FAILED', 'SENT', 'MANUAL'];

export interface ListOutboxInput {
  /** Stati da mostrare; assente = tutti. */
  readonly statuses?: readonly CrmOutboxStatus[];
  /** Quante righe restituire al massimo (le più recenti). */
  readonly limit?: number;
}

export class CrmOutboxService {
  private readonly logger: ILogger;

  constructor(private readonly deps: CrmOutboxServiceDeps) {
    this.logger = deps.logger.child('[CRM][Outbox]');
  }

  /** Coda di uscita, dalla più recente, con i conteggi per stato. */
  async list(input: ListOutboxInput = {}): Promise<CrmOutboxView> {
    const tutti = await this.deps.outbox.listByStatus(TUTTI);
    const filtrati =
      input.statuses === undefined || input.statuses.length === 0
        ? tutti
        : tutti.filter((e) => input.statuses?.includes(e.status) === true);

    const rows = [...filtrati]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
      .slice(0, input.limit ?? 200)
      .map(toRow);

    return {
      rows,
      counts: {
        pending: tutti.filter((e) => e.status === 'PENDING').length,
        sent: tutti.filter((e) => e.status === 'SENT').length,
        failed: tutti.filter((e) => e.status === 'FAILED').length,
        manual: tutti.filter((e) => e.status === 'MANUAL').length,
      },
    };
  }

  /**
   * "Forza riprova" dal pannello: rispedisce subito il payload salvato, senza aspettare il giro
   * automatico. Vale anche su un evento già abbandonato (FAILED): se il CRM è tornato su, chi
   * preme il pulsante lo sa prima del sistema.
   */
  async retry(eventId: CrmOutboxEventId, correlationId: string): Promise<CrmDelivery> {
    const esito = await this.deps.notifier.retry(eventId, correlationId);
    this.logger.info(`riprova manuale: ${eventId}`, { esito: esito.outcome });
    return esito;
  }
}

function toRow(evento: CrmOutboxEvent): CrmOutboxRowView {
  const code = evento.payload['code'];
  return {
    eventId: evento.id,
    type: evento.type,
    status: evento.status,
    appointmentId: evento.appointmentId,
    code: typeof code === 'string' ? code : null,
    createdAt: evento.createdAt,
    sentAt: evento.sentAt,
    nextAttemptAt: evento.nextAttemptAt,
    attemptCount: evento.attemptCount,
    lastError: evento.lastError,
    crmAckId: evento.crmAckId,
    idempotencyKey: evento.idempotencyKey,
  };
}
