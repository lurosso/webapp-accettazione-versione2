// Mock di SMS Hosting: esiti deterministici per suffisso telefonico, credito simulato,
// calcolo di codifica (GSM-7/UCS-2) e segmenti con warning oltre il singolo segmento,
// idempotenza per idempotencyKey. Mai throw.

import { err, ok } from '@/domain/result';
import { lastDigit, maskPhone } from '@/domain/value-objects/phone';
import { smsSegments } from '../dto/sms-hosting.dto';
import type { SmsSendRequestDto } from '../dto/sms-hosting.dto';
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
import type { ISmsHostingService } from '../interfaces/ISmsHostingService';
import type { ProviderMockMode } from '../interfaces/mock-config';
import { PHONE_OUTCOME_RULES } from './data/phones';
import { SeededRandom, seedFrom } from './data/seeded-random';
import { isAborted, simulateLatency } from './simulate';

/** Opzioni del mock SMS. */
export interface SmsMockOptions {
  /** Suffisso che provoca PROVIDER_ERROR non retryable (default '99'). */
  readonly failSuffix: string;
  /** Se impostato (0-1) sovrascrive la regola delle cifre con un fallimento casuale seminato (env MOCK_SMS_FAILURE_RATE). */
  readonly failureRate: number | null;
  readonly mode: ProviderMockMode;
  readonly latencyMs: number;
  /** Credito iniziale in numero di SMS (segmenti); a 0 → RATE_LIMIT. */
  readonly initialCredits: number;
  readonly seed?: string;
}

/** Dipendenze iniettate. */
export interface SmsMockDeps {
  readonly clock: IClock;
  readonly ids: IIdGenerator;
  readonly logger: ILogger;
}

/** SMS finto. */
export class SmsHostingServiceMock implements ISmsHostingService {
  readonly name = 'SMS_HOSTING' as const;

  private readonly logger: ILogger;
  private readonly receipts = new Map<string, SendReceipt>();
  private readonly sent = new Map<string, SendReceipt>();
  private credits: number;

  constructor(
    private readonly options: SmsMockOptions,
    private readonly deps: SmsMockDeps,
  ) {
    this.logger = deps.logger.child('[MOCK][SmsHosting]');
    this.credits = Math.max(0, options.initialCredits);
  }

  async sendSms(
    request: SmsSendRequestDto,
    options?: CallOptions,
  ): Promise<ProviderResult<SendReceipt>> {
    const signal = options?.signal;
    if (isAborted(signal)) {
      return err(providerError('SMS_HOSTING', 'TIMEOUT', 'Richiesta annullata dal chiamante.', true));
    }

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
      return err(providerError('SMS_HOSTING', 'TIMEOUT', 'Richiesta annullata dal chiamante.', true));
    }

    const failure = this.decideFailure(request);
    if (failure !== null) {
      this.logger.warn(`SMS → ${maskPhone(request.to)} FALLITO`, {
        code: failure.code,
        retryable: failure.retryable,
        idempotencyKey: request.idempotencyKey,
        correlationId: request.correlationId,
      });
      return err(failure);
    }

    // Come un gateway reale: nessun troncamento, ma il testo lungo o fuori GSM-7 costa più segmenti.
    const { encoding, segments, length } = smsSegments(request.text);
    if (segments > 1 || encoding === 'UCS-2') {
      this.logger.warn('testo SMS oltre il singolo segmento GSM-7: costo maggiorato', {
        encoding,
        segments,
        length,
        idempotencyKey: request.idempotencyKey,
      });
    }

    this.credits = Math.max(0, this.credits - segments);
    const receipt: SendReceipt = {
      providerMessageId: `sms-mock-${this.deps.ids.next()}`,
      acceptedAt: this.deps.clock.nowIso(),
    };
    this.receipts.set(request.idempotencyKey, receipt);
    this.sent.set(receipt.providerMessageId, receipt);

    this.logger.info(`SMS → ${maskPhone(request.to)}: "${request.text}"`, {
      providerMessageId: receipt.providerMessageId,
      senderId: request.senderId,
      encoding,
      segments,
      creditsRemaining: this.credits,
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
      return err(providerError('SMS_HOSTING', 'TIMEOUT', 'Richiesta annullata dal chiamante.', true));
    }
    if (this.options.mode === 'down') {
      return err(
        providerError('SMS_HOSTING', 'UNAVAILABLE', 'SMS Hosting non disponibile (simulato).', true),
      );
    }
    const receipt = this.sent.get(providerMessageId);
    if (receipt === undefined) {
      return err(
        providerError('SMS_HOSTING', 'NOT_FOUND', `SMS sconosciuto: ${providerMessageId}.`, false),
      );
    }
    // Nel mock un SMS accettato è considerato consegnato.
    return ok({
      providerMessageId,
      state: 'DELIVERED',
      updatedAt: this.deps.clock.nowIso(),
      reason: null,
    });
  }

  async getCredits(options?: CallOptions): Promise<ProviderResult<{ readonly remaining: number }>> {
    if (isAborted(options?.signal)) {
      return err(providerError('SMS_HOSTING', 'TIMEOUT', 'Richiesta annullata dal chiamante.', true));
    }
    if (this.options.mode === 'down') {
      return err(
        providerError('SMS_HOSTING', 'UNAVAILABLE', 'SMS Hosting non disponibile (simulato).', true),
      );
    }
    return ok({ remaining: this.credits });
  }

  async healthCheck(): Promise<HealthStatus> {
    const status: HealthStatus['status'] =
      this.options.mode === 'down' ? 'DOWN' : this.credits === 0 ? 'DEGRADED' : 'UP';
    return {
      provider: 'SMS_HOSTING',
      status,
      checkedAt: this.deps.clock.nowIso(),
      // Nessuna chiamata reale misurata: la latenza simulata è riportata in `detail`.
      latencyMs: null,
      detail: `mock mode=${this.options.mode}, credits=${this.credits}, latenza simulata=${this.options.latencyMs} ms`,
      implementation: 'mock',
    };
  }

  private decideFailure(request: SmsSendRequestDto): ProviderError | null {
    if (this.options.mode === 'down') {
      return providerError('SMS_HOSTING', 'UNAVAILABLE', 'SMS Hosting non disponibile (simulato).', true);
    }
    if (this.credits <= 0) {
      return providerError('SMS_HOSTING', 'RATE_LIMIT', 'Credito SMS esaurito (simulato).', false);
    }
    if (this.options.failureRate !== null) {
      const rng = new SeededRandom(seedFrom(this.options.seed ?? 'sms', request.idempotencyKey));
      return rng.chance(this.options.failureRate)
        ? providerError('SMS_HOSTING', 'PROVIDER_ERROR', 'Invio SMS fallito (failureRate simulato).', false)
        : null;
    }
    if (this.options.failSuffix.length > 0 && request.to.endsWith(this.options.failSuffix)) {
      return providerError(
        'SMS_HOSTING',
        'PROVIDER_ERROR',
        `Numero rifiutato dal gateway SMS (suffisso ${this.options.failSuffix}, simulato).`,
        false,
      );
    }
    if (lastDigit(request.to) === PHONE_OUTCOME_RULES.timeout) {
      return providerError('SMS_HOSTING', 'TIMEOUT', 'SMS Hosting non ha risposto in tempo (simulato).', true);
    }
    return null;
  }
}
