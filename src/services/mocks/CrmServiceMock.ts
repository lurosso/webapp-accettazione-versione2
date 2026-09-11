// Mock del CRM/BDC: logga il payload JSON, restituisce ack progressivi, idempotente per
// idempotencyKey ed espone `received` per le asserzioni nei test. Mai throw.

import { err, ok } from '@/domain/result';
import type {
  CrmAckDto,
  CrmAnomalyPayloadDto,
  CrmCheckInPayloadDto,
  CrmNoShowPayloadDto,
} from '../dto/crm.dto';
import type {
  CallOptions,
  HealthStatus,
  ProviderError,
  ProviderResult,
} from '../interfaces/common';
import { providerError } from '../interfaces/common';
import type { IClock } from '../interfaces/IClock';
import type { CrmPayload, ICrmService } from '../interfaces/ICrmService';
import type { ILogger } from '../interfaces/ILogger';
import type { CrmMockMode } from '../interfaces/mock-config';
import { isAborted, simulateLatency } from './simulate';

/** Modalità del mock CRM (env MOCK_CRM_MODE); definita in interfaces/mock-config. */
export type { CrmMockMode } from '../interfaces/mock-config';
export type { CrmPayload } from '../interfaces/ICrmService';

/** Opzioni del mock CRM. */
export interface CrmMockOptions {
  readonly mode: CrmMockMode;
  readonly latencyMs: number;
}

/** Dipendenze iniettate. */
export interface CrmMockDeps {
  readonly clock: IClock;
  readonly logger: ILogger;
}

const DEFAULT_TIMEOUT_MS = 5000;

/** CRM finto. */
export class CrmServiceMock implements ICrmService {
  readonly name = 'CRM' as const;

  private readonly logger: ILogger;
  private readonly acks = new Map<string, CrmAckDto>();
  private readonly receivedPayloads: CrmPayload[] = [];
  private callCount = 0;
  private ackCounter = 0;

  constructor(
    private readonly options: CrmMockOptions,
    private readonly deps: CrmMockDeps,
  ) {
    this.logger = deps.logger.child('[MOCK][Crm]');
  }

  /** Payload ricevuti con successo, nell'ordine (per i test). */
  get received(): readonly CrmPayload[] {
    return this.receivedPayloads;
  }

  async notifyNoShow(
    payload: CrmNoShowPayloadDto,
    options?: CallOptions,
  ): Promise<ProviderResult<CrmAckDto>> {
    return this.deliver('notifyNoShow', payload, options);
  }

  async notifyAnomaly(
    payload: CrmAnomalyPayloadDto,
    options?: CallOptions,
  ): Promise<ProviderResult<CrmAckDto>> {
    return this.deliver('notifyAnomaly', payload, options);
  }

  /** Accettazione conclusa al veicolo: note e foto raccolte al tablet. */
  async notifyCheckIn(
    payload: CrmCheckInPayloadDto,
    options?: CallOptions,
  ): Promise<ProviderResult<CrmAckDto>> {
    return this.deliver('notifyCheckIn', payload, options);
  }

  async healthCheck(): Promise<HealthStatus> {
    const status: HealthStatus['status'] =
      this.options.mode === 'ok' ? 'UP' : this.options.mode === 'flaky' ? 'DEGRADED' : 'DOWN';
    return {
      provider: 'CRM',
      status,
      checkedAt: this.deps.clock.nowIso(),
      // Nessuna chiamata reale misurata: la latenza simulata è riportata in `detail`.
      latencyMs: null,
      detail: `mock mode=${this.options.mode}, latenza simulata=${this.options.latencyMs} ms`,
      implementation: 'mock',
    };
  }

  private async deliver(
    operation: string,
    payload: CrmPayload,
    options: CallOptions | undefined,
  ): Promise<ProviderResult<CrmAckDto>> {
    const signal = options?.signal;
    if (isAborted(signal)) {
      return err(providerError('CRM', 'TIMEOUT', 'Richiesta annullata dal chiamante.', true));
    }

    const existing = this.acks.get(payload.idempotencyKey);
    if (existing !== undefined) {
      this.logger.debug(`${operation}: payload già ricevuto, ack riutilizzato`, {
        idempotencyKey: payload.idempotencyKey,
        ackId: existing.ackId,
      });
      return ok(existing);
    }

    this.callCount += 1;
    const failure = await this.simulateFailure(options);
    if (failure !== null) {
      this.logger.warn(`${operation} FALLITA (simulata)`, {
        code: failure.code,
        retryable: failure.retryable,
        idempotencyKey: payload.idempotencyKey,
        correlationId: options?.correlationId ?? null,
      });
      return err(failure);
    }

    this.ackCounter += 1;
    const ack: CrmAckDto = {
      ackId: `crm-mock-${this.ackCounter}`,
      receivedAt: this.deps.clock.nowIso(),
    };
    this.acks.set(payload.idempotencyKey, ack);
    this.receivedPayloads.push(payload);
    this.logger.info(`${operation} ${JSON.stringify(payload)}`, {
      ackId: ack.ackId,
      correlationId: options?.correlationId ?? null,
    });
    return ok(ack);
  }

  private async simulateFailure(options: CallOptions | undefined): Promise<ProviderError | null> {
    const signal = options?.signal;
    if (this.options.mode === 'timeout') {
      const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      await simulateLatency(timeoutMs + 50, signal);
      return providerError(
        'CRM',
        'TIMEOUT',
        `Il CRM non ha risposto entro ${timeoutMs} ms (simulato).`,
        true,
      );
    }
    const completed = await simulateLatency(this.options.latencyMs, signal);
    if (!completed) {
      return providerError('CRM', 'TIMEOUT', 'Richiesta annullata dal chiamante.', true);
    }
    if (this.options.mode === 'error') {
      return providerError(
        'CRM',
        'PROVIDER_ERROR',
        'Il CRM ha rifiutato il webhook (simulato).',
        false,
      );
    }
    if (this.options.mode === 'flaky' && this.callCount % 3 === 0) {
      return providerError(
        'CRM',
        'NETWORK',
        'Connessione al CRM interrotta (simulato, 1 su 3).',
        true,
      );
    }
    return null;
  }
}
