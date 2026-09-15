// Implementazione della porta `ISpokiService` sopra le automazioni Spoki. È quella che il
// factory sceglie con `SPOKI_PROVIDER=real`; modalità (`SPOKI_MODE`) e blocco di sicurezza
// (`SPOKI_SAFETY_LOCK`) decidono se l'adapter chiama davvero Spoki o formatta soltanto.
// L'orchestratore delle notifiche non vede differenza rispetto al mock: stesse ricevute, stessi
// errori con `retryable`, stesso ripiego su SMS quando serve.
//
// Idempotenza: la stessa `idempotencyKey` restituisce la stessa ricevuta senza richiamare Spoki.
// Consegna: quando la chiamata è bloccata il messaggio risulta subito consegnato (così il flusso
// "consegnato → nessun SMS" si prova per intero); in live resta SENT finché il webhook non dice altro.
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
  canDeliverLive,
  SPOKI_ACTIVE_TEMPLATE_KINDS,
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
      {
        mode: config.mode,
        safetyLock: config.safetyLock,
        apiKey: config.apiKey,
        timeoutMs: config.timeoutMs,
      },
      {
        clock: deps.clock,
        ids: deps.ids,
        logger: deps.logger,
        activityLog: deps.activityLog,
        fetchImpl: deps.fetchImpl,
      },
    );
  }

  /** True solo se un WhatsApp reale può partire (live e blocco tolto). */
  get liveDeliveryAllowed(): boolean {
    return canDeliverLive(this.config.mode, this.config.safetyLock);
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
      // Template senza automazione Spoki: l'orchestratore ripiega sull'SMS, che il testo
      // renderizzato lo porta comunque.
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
      payload: buildWebhookPayload(request, this.config.secrets[kind]),
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
      esito.value.blockedBy === null ? 'SENT' : 'DELIVERED',
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
    // Contano solo i template integrati in questa fase: gli altri non hanno automazione.
    const senzaUrl = SPOKI_ACTIVE_TEMPLATE_KINDS.filter((k) => this.config.urls[k] === null);
    const senzaSegreto = SPOKI_ACTIVE_TEMPLATE_KINDS.filter((k) => this.config.secrets[k] === null);
    const configurazione = [
      senzaUrl.length > 0 ? `URL non configurati: ${senzaUrl.join(', ')}` : null,
      senzaSegreto.length > 0 ? `segreti non configurati: ${senzaSegreto.join(', ')}` : null,
    ].filter((s): s is string => s !== null);

    if (!this.liveDeliveryAllowed) {
      const motivo =
        this.config.mode !== 'live'
          ? 'simulazione: nessuna chiamata a Spoki, payload nel registro'
          : 'BLOCCATO dal safety lock (SPOKI_SAFETY_LOCK=true): nessuna chiamata a Spoki, payload nel registro';
      return {
        provider: 'SPOKI',
        status: 'UP',
        checkedAt: this.deps.clock.nowIso(),
        latencyMs: null,
        detail: [motivo, ...configurazione].join('; '),
        implementation: 'real',
      };
    }
    return {
      provider: 'SPOKI',
      status: configurazione.length === 0 ? 'UP' : 'DEGRADED',
      checkedAt: this.deps.clock.nowIso(),
      latencyMs: null,
      detail:
        configurazione.length === 0
          ? 'live: configurazione completa, i WhatsApp partono davvero'
          : `live: ${configurazione.join('; ')}`,
      implementation: 'real',
    };
  }

  /** Template gestiti, con URL e presenza del segreto (per la pagina di amministrazione). */
  templates(): readonly {
    kind: SpokiTemplateKind;
    active: boolean;
    url: string | null;
    secretConfigured: boolean;
  }[] {
    return SPOKI_TEMPLATE_KINDS.map((kind) => ({
      kind,
      active: SPOKI_ACTIVE_TEMPLATE_KINDS.includes(kind),
      url: this.config.urls[kind],
      secretConfigured: this.config.secrets[kind] !== null,
    }));
  }
}

/**
 * Dalle variabili dell'orchestratore al payload dell'automazione Spoki (formato del fornitore):
 * `phone` in E.164, nome e cognome, e-mail se nota, e i campi dinamici in `custom_fields`
 * (`code` F041, `plate`, `time` HH:mm, `date` GG/MM/AAAA, `portal_url`).
 */
export function buildWebhookPayload(
  request: SpokiSendRequestDto,
  secret: string | null,
): SpokiWebhookPayload {
  const v = request.variables;
  return {
    secret: secret ?? '',
    phone: request.to,
    first_name: v['firstName'] ?? '',
    last_name: v['lastName'] ?? '',
    email: v['email'] ?? '',
    custom_fields: {
      code: v['code'] ?? '',
      plate: v['plate'] ?? '',
      time: v['scheduledTime'] ?? '',
      date: v['scheduledDate'] ?? '',
      portal_url: v['portalUrl'] ?? '',
    },
  };
}
