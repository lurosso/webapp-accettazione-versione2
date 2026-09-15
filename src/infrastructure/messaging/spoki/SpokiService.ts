// Implementazione della porta `ISpokiService` sopra le automazioni Spoki. È quella che il
// factory sceglie con `SPOKI_PROVIDER=real`; la modalità (`SPOKI_MODE`) decide se l'adapter
// chiama davvero Spoki o simula. L'orchestratore delle notifiche non vede differenza rispetto al
// mock: stesse ricevute, stessi errori con `retryable`, stesso ripiego su SMS quando serve.
//
// Idempotenza: la stessa `idempotencyKey` restituisce la stessa ricevuta senza richiamare Spoki.
// Consegna: in simulazione il messaggio risulta subito consegnato (così il flusso "consegnato →
// nessun SMS" si prova per intero); in live resta SENT finché il webhook di Spoki non dice altro.
import { err, ok, type Result } from '@/domain/result';
import type {
  CallOptions,
  DeliveryStatus,
  HealthStatus,
  ProviderError,
  ProviderResult,
  SendReceipt,
} from '@/services/interfaces/common';
import { providerError } from '@/services/interfaces/common';
import type { SpokiSendRequestDto } from '@/services/dto/spoki.dto';
import type { IClock } from '@/services/interfaces/IClock';
import type { IIdGenerator } from '@/services/interfaces/IIdGenerator';
import type { ILogger } from '@/services/interfaces/ILogger';
import type { ISpokiActivityLog } from '@/services/interfaces/ISpokiActivityLog';
import type { ISpokiService } from '@/services/interfaces/ISpokiService';
import { SpokiClientAdapter, type FetchLike } from './SpokiClientAdapter';
import {
  SPOKI_TEMPLATE_KINDS,
  TEMPLATE_KIND_BY_KEY,
  type SpokiServiceConfig,
  type SpokiTemplateKind,
  type SpokiWebhookPayload,
} from './spoki-config';

export interface SpokiServiceDeps {
  readonly clock: IClock;
  readonly ids: IIdGenerator;
  readonly logger: ILogger;
  readonly activityLog: ISpokiActivityLog;
  readonly fetchImpl?: FetchLike | undefined;
}

const WEBHOOK_STATES: readonly DeliveryStatus['state'][] = [
  'QUEUED',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED',
  'UNDELIVERABLE',
];

export class SpokiService implements ISpokiService {
  readonly name = 'SPOKI' as const;

  private readonly adapter: SpokiClientAdapter;
  private readonly receipts = new Map<string, SendReceipt>();
  private readonly deliveries = new Map<string, DeliveryStatus['state']>();

  constructor(
    private readonly config: SpokiServiceConfig,
    private readonly deps: SpokiServiceDeps,
  ) {
    this.adapter = new SpokiClientAdapter(
      { mode: config.mode, apiKey: config.apiKey, timeoutMs: config.timeoutMs },
      {
        clock: deps.clock,
        ids: deps.ids,
        logger: deps.logger,
        activityLog: deps.activityLog,
        fetchImpl: deps.fetchImpl,
      },
    );
  }

  async sendTemplateMessage(
    request: SpokiSendRequestDto,
    options?: CallOptions,
  ): Promise<ProviderResult<SendReceipt>> {
    const existing = this.receipts.get(request.idempotencyKey);
    if (existing !== undefined) {
      return ok(existing);
    }
    const kind = TEMPLATE_KIND_BY_KEY[request.templateKey];
    if (kind === undefined) {
      // Template senza automazione Spoki (es. promemoria del mattino): l'orchestratore ripiega
      // sull'SMS, che il testo renderizzato lo porta comunque.
      return err(
        providerError(
          'SPOKI',
          'INVALID_REQUEST',
          `Nessuna automazione Spoki per il template "${request.templateKey}".`,
          false,
        ),
      );
    }
    const esito = await this.adapter.trigger({
      kind,
      templateKey: request.templateKey,
      url: this.config.urls[kind],
      payload: buildWebhookPayload(request),
      correlationId: request.correlationId,
      options,
    });
    if (!esito.ok) {
      return esito;
    }
    const receipt: SendReceipt = {
      providerMessageId: esito.value.messageId,
      acceptedAt: esito.value.acceptedAt,
    };
    this.receipts.set(request.idempotencyKey, receipt);
    this.deliveries.set(
      receipt.providerMessageId,
      this.config.mode === 'simulation' ? 'DELIVERED' : 'SENT',
    );
    return ok(receipt);
  }

  async getDeliveryStatus(
    providerMessageId: string,
    _options?: CallOptions,
  ): Promise<ProviderResult<DeliveryStatus>> {
    const state = this.deliveries.get(providerMessageId);
    if (state === undefined) {
      return err(
        providerError('SPOKI', 'NOT_FOUND', `Messaggio sconosciuto: ${providerMessageId}.`, false),
      );
    }
    return ok({
      providerMessageId,
      state,
      updatedAt: this.deps.clock.nowIso(),
      reason: null,
    });
  }

  /** Webhook di esito: aggiorna lo stato noto e lo restituisce (formato `{ messageId, status }`). */
  parseWebhook(
    rawBody: unknown,
    _headers: Readonly<Record<string, string>>,
  ): Result<DeliveryStatus, ProviderError> {
    if (typeof rawBody !== 'object' || rawBody === null) {
      return err(
        providerError('SPOKI', 'INVALID_REQUEST', 'Webhook Spoki: corpo non valido.', false),
      );
    }
    const body = rawBody as Record<string, unknown>;
    const messageId = body['messageId'] ?? body['message_id'] ?? body['id'];
    const status = body['status'];
    if (typeof messageId !== 'string' || typeof status !== 'string') {
      return err(
        providerError(
          'SPOKI',
          'INVALID_REQUEST',
          'Webhook Spoki: messageId o status mancanti.',
          false,
        ),
      );
    }
    const state = WEBHOOK_STATES.find((s) => s === status.toUpperCase());
    if (state === undefined) {
      return err(
        providerError(
          'SPOKI',
          'INVALID_REQUEST',
          `Webhook Spoki: stato sconosciuto "${status}".`,
          false,
        ),
      );
    }
    this.deliveries.set(messageId, state);
    const reason = body['reason'];
    return ok({
      providerMessageId: messageId,
      state,
      updatedAt: this.deps.clock.nowIso(),
      reason: typeof reason === 'string' ? reason : null,
    });
  }

  async healthCheck(): Promise<HealthStatus> {
    const mancanti = SPOKI_TEMPLATE_KINDS.filter((k) => this.config.urls[k] === null);
    if (this.config.mode === 'simulation') {
      return {
        provider: 'SPOKI',
        status: 'UP',
        checkedAt: this.deps.clock.nowIso(),
        latencyMs: null,
        detail: `simulazione: nessuna chiamata a Spoki, payload nel registro${
          mancanti.length > 0 ? `; URL non configurati: ${mancanti.join(', ')}` : ''
        }`,
        implementation: 'real',
      };
    }
    const problemi: string[] = [];
    if (this.config.apiKey === null) {
      problemi.push('SPOKI_API_KEY mancante');
    }
    if (mancanti.length > 0) {
      problemi.push(`URL non configurati: ${mancanti.join(', ')}`);
    }
    return {
      provider: 'SPOKI',
      status: problemi.length === 0 ? 'UP' : 'DEGRADED',
      checkedAt: this.deps.clock.nowIso(),
      latencyMs: null,
      detail:
        problemi.length === 0 ? 'live: configurazione completa' : `live: ${problemi.join('; ')}`,
      implementation: 'real',
    };
  }

  /** Template gestiti e loro URL (per la pagina di amministrazione). */
  templates(): readonly { kind: SpokiTemplateKind; url: string | null }[] {
    return SPOKI_TEMPLATE_KINDS.map((kind) => ({ kind, url: this.config.urls[kind] }));
  }
}

/** Dalle variabili dell'orchestratore al payload piatto dell'automazione. */
export function buildWebhookPayload(request: SpokiSendRequestDto): SpokiWebhookPayload {
  const v = request.variables;
  return {
    phone: request.to,
    first_name: v['firstName'] ?? '',
    code: v['code'] ?? '',
    plate: v['plate'] ?? '',
    scheduled_time: v['scheduledTime'] ?? '',
    brand: v['brandName'] ?? '',
    portal_url: v['portalUrl'] ?? '',
    text: v['text'] ?? '',
    template: request.templateKey,
    correlation_id: request.correlationId,
    idempotency_key: request.idempotencyKey,
  };
}
