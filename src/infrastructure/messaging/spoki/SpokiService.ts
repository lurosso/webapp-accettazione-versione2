// Implementazione della porta `ISpokiService` sopra Spoki (automazioni e API dei template). È
// quella che il factory sceglie con `SPOKI_PROVIDER=real`; modalità (`SPOKI_MODE`) e blocco di
// sicurezza (`SPOKI_SAFETY_LOCK`) decidono se l'adapter chiama davvero Spoki o formatta soltanto.
// L'orchestratore delle notifiche non vede differenza rispetto al mock: stesse ricevute, stessi
// errori con `retryable`, stesso ripiego su SMS quando serve.
//
// Per ogni template si sceglie il trasporto: se c'è l'id del template (SPOKI_TEMPLATE_*_ID) si
// passa dalle API (`/api/1/messages/send/`), altrimenti dall'URL dell'automazione (SPOKI_URL_*).
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
import type {
  SpokiContactUpdateDto,
  SpokiContactUpdateReceipt,
  SpokiSendRequestDto,
} from '@/services/dto/spoki.dto';
import { parseSpokiWebhookBody, type SpokiWebhookEvent } from '@/services/dto/spoki-webhook.dto';
import type { IClock } from '@/services/interfaces/IClock';
import type { IIdGenerator } from '@/services/interfaces/IIdGenerator';
import type { ILogger } from '@/services/interfaces/ILogger';
import type { ISpokiActivityLog } from '@/services/interfaces/ISpokiActivityLog';
import type { ISpokiService } from '@/services/interfaces/ISpokiService';
import { SpokiClientAdapter, type FetchLike } from './SpokiClientAdapter';
import {
  canDeliverLive,
  maskForLog,
  payloadForLog,
  reminderStateAfter,
  resolveTransportKind,
  SPOKI_ACTIVE_TEMPLATE_KINDS,
  SPOKI_QUICK_REPLIES,
  SPOKI_TEMPLATE_ID_ENV_KEYS,
  SPOKI_TEMPLATE_KINDS,
  TEMPLATE_KIND_BY_KEY,
  templateFieldsFor,
  type SpokiCustomFields,
  type SpokiServiceConfig,
  type SpokiTemplateKind,
  type SpokiTemplateSendPayload,
  type SpokiTextSendPayload,
  type SpokiTransport,
  type SpokiWebhookPayload,
} from './spoki-config';

export interface SpokiServiceDeps {
  readonly clock: IClock;
  readonly ids: IIdGenerator;
  readonly logger: ILogger;
  readonly activityLog: ISpokiActivityLog;
  readonly fetchImpl?: FetchLike | undefined;
}

/** Com'è configurato un template: quale trasporto usa e se ha tutto quello che serve. */
export interface SpokiTemplateSetup {
  readonly kind: SpokiTemplateKind;
  readonly active: boolean;
  readonly transport: 'TEMPLATE' | 'AUTOMATION' | 'TEXT';
  readonly url: string | null;
  readonly secretConfigured: boolean;
  readonly templateId: string | null;
  /** Variabile d'ambiente dell'id del template, quando il trasporto è via API. */
  readonly templateEnvKey: string | null;
  /** Pronto per il live: URL e segreto (automazione) oppure id del template (API). */
  readonly configured: boolean;
}

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
        apiBaseUrl: config.apiBaseUrl,
        timeoutMs: config.timeoutMs,
        allowedRecipients: config.allowedRecipients ?? [],
        publicSends: config.publicSends === true,
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
      // Template senza configurazione Spoki: l'orchestratore ripiega sull'SMS, che il testo
      // renderizzato lo porta comunque.
      return err(
        providerError(
          'SPOKI',
          'INVALID_REQUEST',
          `Nessuna automazione o template Spoki per "${request.templateKey}".`,
          false,
        ),
      );
    }
    const transport = this.transportFor(kind, request);
    // Un template non parte con un campo vuoto: Meta lo rifiuterebbe, e un «Sede:» vuoto al cliente
    // non va. Si dice quale manca, nel registro e all'orchestratore (che ripiega sull'SMS).
    if (transport.kind !== 'TEXT') {
      const { missing } = templateFieldsFor(kind, request.variables);
      if (missing.length > 0) {
        const messaggio = `${kind}: campi del template vuoti (${missing.join(', ')}), il messaggio non parte.`;
        this.deps.activityLog.record({
          at: this.deps.clock.nowIso(),
          mode: this.config.mode,
          templateKind: kind,
          templateKey: request.templateKey,
          url: null,
          phoneMasked: maskForLog(request.to),
          payload: payloadForLog(transport.payload),
          blockedBy: null,
          outcome: { ok: false, httpStatus: null, messageId: null, error: messaggio },
          correlationId: request.correlationId,
        });
        return err(providerError('SPOKI', 'INVALID_REQUEST', messaggio, false));
      }
    }
    const esito = await this.adapter.trigger({
      kind,
      templateKey: request.templateKey,
      transport,
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

  /**
   * Il trasporto di un template (vedi `resolveTransportKind`): l'id del template vince
   * sull'automazione; senza configurazione si sceglie quello previsto, così in simulazione il
   * registro dice cosa manca e in live l'adapter lo spiega.
   */
  private transportFor(kind: SpokiTemplateKind, request: SpokiSendRequestDto): SpokiTransport {
    const templateId = this.config.templates[kind];
    const opzioni = { safetyNetFields: this.config.safetyNetFields === true };
    const scelto = resolveTransportKind(kind, templateId, this.config.urls[kind]);
    if (scelto === 'TEMPLATE') {
      return {
        kind: 'TEMPLATE',
        templateId,
        payload: buildTemplateSendPayload(request, kind, templateId, opzioni),
      };
    }
    if (scelto === 'TEXT') {
      return { kind: 'TEXT', payload: buildTextSendPayload(request, kind) };
    }
    return {
      kind: 'AUTOMATION',
      url: this.config.urls[kind],
      payload: buildWebhookPayload(request, kind, this.config.secrets[kind], opzioni),
    };
  }

  async updateContactFields(
    request: SpokiContactUpdateDto,
    options?: CallOptions,
  ): Promise<ProviderResult<SpokiContactUpdateReceipt>> {
    const esito = await this.adapter.updateContact({
      phone: request.to,
      customFields: request.fields,
      correlationId: request.correlationId,
      options,
    });
    return esito.ok ? ok({ updated: esito.value.updated }) : esito;
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

  /** Webhook di Spoki (V2 o forma piatta): normalizza e, per gli esiti, aggiorna lo stato noto. */
  parseWebhook(
    rawBody: unknown,
    _headers: Readonly<Record<string, string>>,
  ): Result<SpokiWebhookEvent, ProviderError> {
    const parsed = parseSpokiWebhookBody(rawBody);
    if (parsed.ok && parsed.value.kind === 'DELIVERY') {
      this.deliveries.set(parsed.value.providerMessageId, parsed.value.state);
    }
    return parsed;
  }

  async healthCheck(): Promise<HealthStatus> {
    // Contano solo i template integrati: gli altri non hanno configurazione Spoki.
    const mancanti = this.templates()
      .filter((t) => t.active && !t.configured)
      .map((t) =>
        t.transport === 'TEMPLATE'
          ? `${t.kind} (${t.templateEnvKey ?? 'id template'})`
          : `${t.kind} (${t.url === null ? 'URL' : ''}${t.url === null && !t.secretConfigured ? ' e ' : ''}${t.secretConfigured ? '' : 'segreto'})`,
      );
    const configurazione =
      mancanti.length > 0 ? [`template non configurati: ${mancanti.join(', ')}`] : [];
    if (
      this.config.apiKey === null &&
      this.templates().some((t) => t.active && t.transport === 'TEMPLATE')
    ) {
      configurazione.push(
        'chiave API assente (SPOKI_API_KEY): i template via API non possono partire',
      );
    }

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

  /** Template gestiti, con trasporto e completezza della configurazione (per la pagina di amministrazione). */
  templates(): readonly SpokiTemplateSetup[] {
    return SPOKI_TEMPLATE_KINDS.map((kind) => {
      const templateEnvKey = SPOKI_TEMPLATE_ID_ENV_KEYS[kind];
      const templateId = this.config.templates[kind];
      const url = this.config.urls[kind];
      const secretConfigured = this.config.secrets[kind] !== null;
      const transport = resolveTransportKind(kind, templateId, url);
      return {
        kind,
        active: SPOKI_ACTIVE_TEMPLATE_KINDS.includes(kind),
        transport,
        url,
        secretConfigured,
        templateId,
        templateEnvKey,
        configured:
          transport === 'TEMPLATE'
            ? templateId !== null && this.config.apiKey !== null
            : transport === 'TEXT'
              ? this.config.apiKey !== null
              : url !== null && secretConfigured,
      };
    });
  }
}

/**
 * Dalle variabili dell'orchestratore al payload dell'automazione Spoki (formato del fornitore):
 * `phone` in E.164, nome e cognome, e-mail se nota, e in `custom_fields` i campi del template
 * (`SPOKI_TEMPLATE_FIELDS`).
 */
export function buildWebhookPayload(
  request: SpokiSendRequestDto,
  kind: SpokiTemplateKind,
  secret: string | null,
  options: PayloadOptions = {},
): SpokiWebhookPayload {
  const v = request.variables;
  return {
    secret: secret ?? '',
    phone: request.to,
    first_name: v['firstName'] ?? '',
    last_name: v['lastName'] ?? '',
    email: v['email'] ?? '',
    custom_fields: customFieldsOf(request, kind, options),
  };
}

/**
 * Payload di `POST /api/1/messages/send/` per un template approvato: stesso numero e stessi campi
 * dinamici dell'automazione, più l'id del template, la lingua, i pulsanti rapidi con il loro
 * payload (dove il template li ha) e i metadati tecnici che Spoki rimanda nel webhook di esito
 * (per ritrovare il messaggio anche senza il suo id).
 */
export function buildTemplateSendPayload(
  request: SpokiSendRequestDto,
  kind: SpokiTemplateKind,
  templateId: string | null,
  options: PayloadOptions = {},
): SpokiTemplateSendPayload {
  const v = request.variables;
  const numerico = templateId !== null && /^\d+$/.test(templateId) ? Number(templateId) : null;
  const pulsanti = SPOKI_QUICK_REPLIES[kind];
  return {
    type: 'Template',
    phone: request.to,
    template: numerico ?? templateId ?? '',
    language: 'IT',
    first_name: v['firstName'] ?? '',
    last_name: v['lastName'] ?? '',
    email: v['email'] ?? '',
    custom_fields: customFieldsOf(request, kind, options),
    ...(pulsanti === undefined
      ? {}
      : { buttons: pulsanti.map((b) => ({ order: b.order, payload: b.payload })) }),
    metadata: {
      idempotency_key: request.idempotencyKey,
      template_kind: kind,
      correlation_id: request.correlationId,
    },
  };
}

/** Opzioni dei payload: con la rete di sicurezza accesa si scrivono anche i suoi campi. */
export interface PayloadOptions {
  readonly safetyNetFields?: boolean;
}

/**
 * I campi del template (`SPOKI_TEMPLATE_FIELDS`): Spoki li salva sul contatto a ogni invio, così
 * anche le automazioni li ritrovano. Con la rete di sicurezza del mattino si aggiungono ACC_GIORNO
 * e ACC_PROMEMORIA.
 */
function customFieldsOf(
  request: SpokiSendRequestDto,
  kind: SpokiTemplateKind,
  options: PayloadOptions,
): SpokiCustomFields {
  const { fields } = templateFieldsFor(kind, request.variables);
  if (options.safetyNetFields !== true) {
    return fields;
  }
  return {
    ...fields,
    ACC_GIORNO: request.variables['scheduledDay'] ?? '',
    ACC_PROMEMORIA: reminderStateAfter(kind),
  };
}

/**
 * Payload del messaggio libero: il testo che l'app ha già preparato (codice, link personale,
 * «troppo presto»…), con gli stessi metadati tecnici dell'invio di un template.
 */
export function buildTextSendPayload(
  request: SpokiSendRequestDto,
  kind: SpokiTemplateKind,
): SpokiTextSendPayload {
  return {
    type: 'Message',
    content_type: 'Text',
    phone: request.to,
    text: request.variables['text'] ?? '',
    metadata: {
      idempotency_key: request.idempotencyKey,
      template_kind: kind,
      correlation_id: request.correlationId,
    },
  };
}
