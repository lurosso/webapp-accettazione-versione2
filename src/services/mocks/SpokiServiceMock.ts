// Mock di Spoki (WhatsApp): esiti deterministici decisi dall'ultima cifra del telefono,
// registro in memoria delle consegne, idempotenza per idempotencyKey. Mai throw.

import { err, ok } from '@/domain/result';
import type { Result } from '@/domain/result';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import { lastDigit, maskPhone } from '@/domain/value-objects/phone';
import type { SpokiSendRequestDto } from '../dto/spoki.dto';
import type {
  CallOptions,
  DeliveryStatus,
  HealthStatus,
  ProviderError,
  ProviderResult,
  SendReceipt,
} from '../interfaces/common';
import { providerError } from '../interfaces/common';
import type { IClock } from '../interfaces/IClock';
import type { IIdGenerator } from '../interfaces/IIdGenerator';
import type { ILogger } from '../interfaces/ILogger';
import type { ISpokiService } from '../interfaces/ISpokiService';
import type { ProviderMockMode } from '../interfaces/mock-config';
import { PHONE_OUTCOME_RULES } from './data/phones';
import { SeededRandom, seedFrom } from './data/seeded-random';
import { isAborted, simulateLatency } from './simulate';

/** Opzioni del mock Spoki. */
export interface SpokiMockOptions {
  /** Suffisso che provoca INVALID_REQUEST non retryable (default '9'). */
  readonly failSuffix: string;
  /** Se impostato (0-1) sovrascrive la regola delle cifre con un fallimento casuale seminato. */
  readonly failureRate: number | null;
  readonly mode: ProviderMockMode;
  readonly latencyMs: number;
  /**
   * Dopo quanti ms (orologio iniettato) un messaggio SENT passa a DELIVERED.
   * L'esito UNDELIVERABLE (ultima cifra 7) è invece immediato, così il fallback SMS
   * viene esercitato anche con SystemClock e senza refresh periodico (M3).
   */
  readonly deliveryDelayMs: number;
  readonly seed: string;
}

/** Dipendenze iniettate. */
export interface SpokiMockDeps {
  readonly clock: IClock;
  readonly ids: IIdGenerator;
  readonly logger: ILogger;
}

interface DeliveryRecord {
  readonly acceptedAtMs: number;
  readonly finalState: 'DELIVERED' | 'UNDELIVERABLE';
}

const WEBHOOK_STATES: readonly DeliveryStatus['state'][] = [
  'QUEUED',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED',
  'UNDELIVERABLE',
];

/** WhatsApp finto. */
export class SpokiServiceMock implements ISpokiService {
  readonly name = 'SPOKI' as const;

  private readonly logger: ILogger;
  private readonly receipts = new Map<string, SendReceipt>();
  private readonly deliveries = new Map<string, DeliveryRecord>();

  constructor(
    private readonly options: SpokiMockOptions,
    private readonly deps: SpokiMockDeps,
  ) {
    this.logger = deps.logger.child('[MOCK][Spoki]');
  }

  async sendTemplateMessage(
    request: SpokiSendRequestDto,
    options?: CallOptions,
  ): Promise<ProviderResult<SendReceipt>> {
    const signal = options?.signal;
    if (isAborted(signal)) {
      return err(providerError('SPOKI', 'TIMEOUT', 'Richiesta annullata dal chiamante.', true));
    }

    // Idempotenza: stesso idempotencyKey → stessa ricevuta, nessun nuovo invio.
    const existing = this.receipts.get(request.idempotencyKey);
    if (existing !== undefined) {
      this.logger.debug('invio già eseguito, ricevuta riutilizzata', {
        idempotencyKey: request.idempotencyKey,
        providerMessageId: existing.providerMessageId,
      });
      return ok(existing);
    }

    const completed = await simulateLatency(this.options.latencyMs, signal);
    if (!completed) {
      return err(providerError('SPOKI', 'TIMEOUT', 'Richiesta annullata dal chiamante.', true));
    }

    const failure = this.decideFailure(request);
    if (failure !== null) {
      this.logger.warn(`WhatsApp → ${maskPhone(request.to)} FALLITO`, {
        code: failure.code,
        retryable: failure.retryable,
        idempotencyKey: request.idempotencyKey,
        correlationId: request.correlationId,
      });
      return err(failure);
    }

    const acceptedAt = this.deps.clock.nowIso();
    const receipt: SendReceipt = {
      providerMessageId: `spoki-mock-${this.deps.ids.next()}`,
      acceptedAt,
    };
    this.receipts.set(request.idempotencyKey, receipt);
    this.deliveries.set(receipt.providerMessageId, {
      acceptedAtMs: new Date(acceptedAt).getTime(),
      finalState:
        lastDigit(request.to) === PHONE_OUTCOME_RULES.whatsappUndeliverable
          ? 'UNDELIVERABLE'
          : 'DELIVERED',
    });

    const text = request.variables['text'] ?? request.templateKey;
    this.logger.info(`WhatsApp → ${maskPhone(request.to)}: "${text}"`, {
      providerMessageId: receipt.providerMessageId,
      templateKey: request.templateKey,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.correlationId,
      latencyMs: this.options.latencyMs,
    });
    return ok(receipt);
  }

  async getDeliveryStatus(
    providerMessageId: string,
    options?: CallOptions,
  ): Promise<ProviderResult<DeliveryStatus>> {
    if (isAborted(options?.signal)) {
      return err(providerError('SPOKI', 'TIMEOUT', 'Richiesta annullata dal chiamante.', true));
    }
    if (this.options.mode === 'down') {
      return err(providerError('SPOKI', 'UNAVAILABLE', 'Spoki non disponibile (simulato).', true));
    }
    const record = this.deliveries.get(providerMessageId);
    if (record === undefined) {
      return err(
        providerError('SPOKI', 'NOT_FOUND', `Messaggio sconosciuto: ${providerMessageId}.`, false),
      );
    }
    const nowMs = this.deps.clock.now().getTime();
    // UNDELIVERABLE è immediato (regola cifra 7); DELIVERED arriva dopo deliveryDelayMs.
    const settled =
      record.finalState === 'UNDELIVERABLE' ||
      nowMs - record.acceptedAtMs >= this.options.deliveryDelayMs;
    const state: DeliveryStatus['state'] = settled ? record.finalState : 'SENT';
    return ok({
      providerMessageId,
      state,
      updatedAt: this.deps.clock.nowIso(),
      reason: state === 'UNDELIVERABLE' ? 'Numero non raggiungibile su WhatsApp (simulato).' : null,
    });
  }

  parseWebhook(
    rawBody: unknown,
    _headers: Readonly<Record<string, string>>,
  ): Result<DeliveryStatus, ProviderError> {
    if (typeof rawBody !== 'object' || rawBody === null) {
      return err(providerError('SPOKI', 'INVALID_REQUEST', 'Webhook Spoki: corpo non valido.', false));
    }
    const body = rawBody as Record<string, unknown>;
    const messageId = body['messageId'];
    const status = body['status'];
    if (typeof messageId !== 'string' || typeof status !== 'string') {
      return err(
        providerError('SPOKI', 'INVALID_REQUEST', 'Webhook Spoki: messageId o status mancanti.', false),
      );
    }
    const state = WEBHOOK_STATES.find((s) => s === status.toUpperCase());
    if (state === undefined) {
      return err(
        providerError('SPOKI', 'INVALID_REQUEST', `Webhook Spoki: stato sconosciuto "${status}".`, false),
      );
    }
    const reason = body['reason'];
    return ok({
      providerMessageId: messageId,
      state,
      updatedAt: this.deps.clock.nowIso(),
      reason: typeof reason === 'string' ? reason : null,
    });
  }

  async healthCheck(): Promise<HealthStatus> {
    return {
      provider: 'SPOKI',
      status: this.options.mode === 'down' ? 'DOWN' : 'UP',
      checkedAt: this.deps.clock.nowIso(),
      // Nessuna chiamata reale misurata: la latenza simulata è riportata in `detail`.
      latencyMs: null,
      detail: `mock mode=${this.options.mode}, failSuffix=${this.options.failSuffix}, latenza simulata=${this.options.latencyMs} ms`,
      implementation: 'mock',
    };
  }

  /** Applica modalità down, failureRate seminato o regola delle cifre. */
  private decideFailure(request: SpokiSendRequestDto): ProviderError | null {
    if (this.options.mode === 'down') {
      return providerError('SPOKI', 'UNAVAILABLE', 'Spoki non disponibile (simulato).', true);
    }
    if (this.options.failureRate !== null) {
      const rng = new SeededRandom(seedFrom(this.options.seed, request.idempotencyKey));
      return rng.chance(this.options.failureRate)
        ? providerError('SPOKI', 'PROVIDER_ERROR', 'Invio WhatsApp fallito (failureRate simulato).', false)
        : null;
    }
    if (this.options.failSuffix.length > 0 && request.to.endsWith(this.options.failSuffix)) {
      return providerError(
        'SPOKI',
        'INVALID_REQUEST',
        `Numero rifiutato da WhatsApp (suffisso ${this.options.failSuffix}, simulato).`,
        false,
      );
    }
    if (lastDigit(request.to) === PHONE_OUTCOME_RULES.timeout) {
      return providerError('SPOKI', 'TIMEOUT', 'Spoki non ha risposto in tempo (simulato).', true);
    }
    return null;
  }

  /** Istante di accettazione registrato per un messaggio (per i test). */
  acceptedAtOf(providerMessageId: string): IsoDateTime | null {
    const record = this.deliveries.get(providerMessageId);
    return record === undefined ? null : (new Date(record.acceptedAtMs).toISOString() as IsoDateTime);
  }
}
