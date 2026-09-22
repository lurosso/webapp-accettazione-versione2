// Adapter HTTP verso Spoki, con il GUARDRAIL anti-invio:
// - se `mode` non è `live` OPPURE il blocco di sicurezza (`safetyLock`) è attivo, NESSUNA chiamata
//   di rete parte. Il payload viene formattato, scritto nel log strutturato e nel registro del
//   pannello admin (con il motivo del blocco), e la risposta è un 200 finto;
// - solo con `mode = live` e blocco tolto si chiama davvero Spoki, in uno dei due modi che il
//   fornitore documenta: il POST all'URL dell'automazione (segreto nel payload) oppure
//   `POST /api/1/messages/send/` con il template per id e la chiave API nell'intestazione
//   `X-Spoki-Api-Key`.
// Non lancia mai: ogni guasto diventa un ProviderError con il flag `retryable` giusto, così
// l'orchestratore decide se ritentare o passare all'SMS.
import { err, ok } from '@/domain/result';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import type { CallOptions, ProviderError, ProviderResult } from '@/services/interfaces/common';
import { providerError } from '@/services/interfaces/common';
import type { IClock } from '@/services/interfaces/IClock';
import type { IIdGenerator } from '@/services/interfaces/IIdGenerator';
import type { ILogger } from '@/services/interfaces/ILogger';
import type { ISpokiActivityLog } from '@/services/interfaces/ISpokiActivityLog';
import type { SpokiMode } from '@/services/interfaces/provider-kinds';
import {
  deliveryBlockReason,
  maskForLog,
  payloadForLog,
  spokiSendUrl,
  type SpokiTemplateKind,
  type SpokiTransport,
} from './spoki-config';

/** Sottoinsieme di `fetch` usato dall'adapter: iniettabile nei test. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface SpokiClientAdapterConfig {
  readonly mode: SpokiMode;
  /** Blocco di sicurezza: con true nessuna chiamata parte, nemmeno in live. */
  readonly safetyLock: boolean;
  readonly apiKey: string | null;
  /** Base delle API Spoki (per l'invio dei template via API). */
  readonly apiBaseUrl: string;
  readonly timeoutMs: number;
}

export interface SpokiClientAdapterDeps {
  readonly clock: IClock;
  readonly ids: IIdGenerator;
  readonly logger: ILogger;
  readonly activityLog: ISpokiActivityLog;
  /** Assente in simulazione; in live, di norma `globalThis.fetch`. */
  readonly fetchImpl?: FetchLike | undefined;
}

export interface TriggerInput {
  readonly kind: SpokiTemplateKind | 'TEST';
  readonly templateKey: string;
  readonly transport: SpokiTransport;
  readonly correlationId: string;
  readonly options?: CallOptions | undefined;
}

export interface TriggerResult {
  readonly httpStatus: number;
  /** Identificativo restituito da Spoki, o generato quando la chiamata è bloccata o senza corpo. */
  readonly messageId: string;
  readonly acceptedAt: IsoDateTime;
  /** Motivo per cui la chiamata NON è partita; null se è stata fatta davvero. */
  readonly blockedBy: 'SIMULATION' | 'SAFETY_LOCK' | null;
}

/** Descrizione dell'indirizzo chiamato, per il registro (anche quando non configurato). */
function describeTarget(transport: SpokiTransport, apiBaseUrl: string): string | null {
  if (transport.kind === 'AUTOMATION') {
    return transport.url;
  }
  return transport.templateId === null
    ? null
    : `${spokiSendUrl(apiBaseUrl)} · template ${transport.templateId}`;
}

export class SpokiClientAdapter {
  private readonly logger: ILogger;

  constructor(
    private readonly config: SpokiClientAdapterConfig,
    private readonly deps: SpokiClientAdapterDeps,
  ) {
    this.logger = deps.logger.child(`[Spoki][${config.mode}${config.safetyLock ? '+lock' : ''}]`);
  }

  get mode(): SpokiMode {
    return this.config.mode;
  }

  /** True solo se una chiamata reale può partire (live e blocco tolto). */
  get liveDeliveryAllowed(): boolean {
    return deliveryBlockReason(this.config.mode, this.config.safetyLock) === null;
  }

  async trigger(input: TriggerInput): Promise<ProviderResult<TriggerResult>> {
    const blocco = deliveryBlockReason(this.config.mode, this.config.safetyLock);
    if (blocco !== null) {
      return this.simulate(input, blocco);
    }
    return this.callLive(input);
  }

  /**
   * Chiamata bloccata: log strutturato del payload (segreto mascherato) e 200 OK finto.
   * Zero rete, zero crediti, nessun cliente disturbato.
   */
  private simulate(
    input: TriggerInput,
    blockedBy: 'SIMULATION' | 'SAFETY_LOCK',
  ): ProviderResult<TriggerResult> {
    const acceptedAt = this.deps.clock.nowIso();
    const messageId = `sim-${this.deps.ids.next()}`;
    const etichetta = blockedBy === 'SAFETY_LOCK' ? 'BLOCCATO (safety lock)' : 'SIMULAZIONE';
    const target = describeTarget(input.transport, this.config.apiBaseUrl);
    this.logger.info(`${etichetta} ${input.kind} → ${maskForLog(input.transport.payload.phone)}`, {
      trasporto: input.transport.kind,
      url: target ?? '(non configurato)',
      template: input.templateKey,
      payload: payloadForLog(input.transport.payload),
      correlationId: input.correlationId,
      bloccatoDa: blockedBy,
      risposta: { status: 200, messageId },
    });
    this.deps.activityLog.record({
      at: acceptedAt,
      mode: this.config.mode,
      templateKind: input.kind,
      templateKey: input.templateKey,
      url: target,
      phoneMasked: maskForLog(input.transport.payload.phone),
      payload: payloadForLog(input.transport.payload),
      blockedBy,
      outcome: { ok: true, httpStatus: 200, messageId, error: null },
      correlationId: input.correlationId,
    });
    return ok({ httpStatus: 200, messageId, acceptedAt, blockedBy });
  }

  private async callLive(input: TriggerInput): Promise<ProviderResult<TriggerResult>> {
    const preparata = this.prepareLiveRequest(input);
    if (!preparata.ok) {
      return this.fail(input, preparata.error, null);
    }
    const fetchImpl = this.deps.fetchImpl;
    if (fetchImpl === undefined) {
      return this.fail(
        input,
        providerError('SPOKI', 'UNAVAILABLE', 'Nessun client HTTP disponibile per Spoki.', false),
        null,
      );
    }
    const { url, headers, body } = preparata.value;

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      input.options?.timeoutMs ?? this.config.timeoutMs,
    );
    input.options?.signal?.addEventListener('abort', () => controller.abort(), { once: true });
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
      const testo = await response.text().catch(() => '');
      if (!response.ok) {
        return this.fail(input, this.errorForStatus(response.status, testo), response.status);
      }
      const messageId = this.extractMessageId(testo) ?? `spoki-${this.deps.ids.next()}`;
      const acceptedAt = this.deps.clock.nowIso();
      this.logger.info(`${input.kind} → ${maskForLog(input.transport.payload.phone)} accettato`, {
        trasporto: input.transport.kind,
        status: response.status,
        messageId,
        correlationId: input.correlationId,
      });
      this.deps.activityLog.record({
        at: acceptedAt,
        mode: 'live',
        templateKind: input.kind,
        templateKey: input.templateKey,
        url: describeTarget(input.transport, this.config.apiBaseUrl),
        phoneMasked: maskForLog(input.transport.payload.phone),
        payload: payloadForLog(input.transport.payload),
        blockedBy: null,
        outcome: { ok: true, httpStatus: response.status, messageId, error: null },
        correlationId: input.correlationId,
      });
      return ok({ httpStatus: response.status, messageId, acceptedAt, blockedBy: null });
    } catch (cause) {
      const timeout = cause instanceof Error && cause.name === 'AbortError';
      return this.fail(
        input,
        providerError(
          'SPOKI',
          timeout ? 'TIMEOUT' : 'NETWORK',
          timeout
            ? 'Spoki non ha risposto in tempo.'
            : `Errore di rete verso Spoki: ${cause instanceof Error ? cause.message : String(cause)}.`,
          true,
          cause,
        ),
        null,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Indirizzo, intestazioni e corpo della chiamata reale, oppure l'errore di configurazione che
   * la rende impossibile (mai ritentabile: un URL, un id o una chiave non compaiono da soli).
   */
  private prepareLiveRequest(
    input: TriggerInput,
  ): ProviderResult<{ url: string; headers: Record<string, string>; body: string }> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
      'x-correlation-id': input.correlationId,
    };
    const t = input.transport;
    if (t.kind === 'AUTOMATION') {
      if (t.url === null) {
        return err(
          providerError(
            'SPOKI',
            'INVALID_REQUEST',
            `URL dell'automazione Spoki non configurato per ${input.kind}.`,
            false,
          ),
        );
      }
      if (t.payload.secret === '') {
        return err(
          providerError(
            'SPOKI',
            'AUTH',
            `Segreto dell'automazione Spoki mancante per ${input.kind}: impossibile chiamare Spoki.`,
            false,
          ),
        );
      }
      // Le automazioni autenticano con il segreto nel payload; la chiave API, se c'è, non guasta.
      if (this.config.apiKey !== null) {
        headers['authorization'] = `Bearer ${this.config.apiKey}`;
      }
      return ok({ url: t.url, headers, body: JSON.stringify(t.payload) });
    }
    if (t.templateId === null) {
      return err(
        providerError(
          'SPOKI',
          'INVALID_REQUEST',
          `Id del template Spoki non configurato per ${input.kind} (SPOKI_TEMPLATE_*_ID).`,
          false,
        ),
      );
    }
    if (this.config.apiKey === null) {
      return err(
        providerError(
          'SPOKI',
          'AUTH',
          `Chiave API Spoki mancante (SPOKI_API_KEY): impossibile inviare il template ${input.kind}.`,
          false,
        ),
      );
    }
    headers['x-spoki-api-key'] = this.config.apiKey;
    return ok({
      url: spokiSendUrl(this.config.apiBaseUrl),
      headers,
      body: JSON.stringify(t.payload),
    });
  }

  private errorForStatus(status: number, body: string): ProviderError {
    const dettaglio = body.trim() === '' ? '' : ` (${body.trim().slice(0, 200)})`;
    if (status === 401 || status === 403) {
      return providerError(
        'SPOKI',
        'AUTH',
        `Spoki ha rifiutato le credenziali (chiave API o segreto dell'automazione)${dettaglio}.`,
        false,
      );
    }
    if (status === 404) {
      return providerError(
        'SPOKI',
        'NOT_FOUND',
        `Automazione o template Spoki non trovati: controlla URL e id${dettaglio}.`,
        false,
      );
    }
    if (status === 429) {
      return providerError('SPOKI', 'RATE_LIMIT', 'Spoki: troppe richieste, riprovare.', true);
    }
    if (status >= 500) {
      return providerError(
        'SPOKI',
        'PROVIDER_ERROR',
        `Errore lato Spoki (${status})${dettaglio}.`,
        true,
      );
    }
    return providerError(
      'SPOKI',
      'INVALID_REQUEST',
      `Spoki ha rifiutato la richiesta (${status})${dettaglio}.`,
      false,
    );
  }

  /**
   * Spoki può rispondere con `uuid`, `id`, `message_id` o `messageId` (anche dentro `message` o
   * `data`): si accetta il primo presente. Senza corpo l'id lo genera l'adapter.
   */
  private extractMessageId(body: string): string | null {
    try {
      const parsed: unknown = JSON.parse(body);
      return this.idIn(parsed, 0);
    } catch {
      return null;
    }
  }

  private idIn(value: unknown, depth: number): string | null {
    if (typeof value !== 'object' || value === null || depth > 2) {
      return null;
    }
    const record = value as Record<string, unknown>;
    for (const key of ['uuid', 'id', 'message_id', 'messageId']) {
      const v = record[key];
      if (typeof v === 'string' && v !== '') {
        return v;
      }
      if (typeof v === 'number') {
        return String(v);
      }
    }
    for (const key of ['message', 'data', 'result']) {
      const trovato = this.idIn(record[key], depth + 1);
      if (trovato !== null) {
        return trovato;
      }
    }
    return null;
  }

  private fail(
    input: TriggerInput,
    error: ProviderError,
    httpStatus: number | null,
  ): ProviderResult<TriggerResult> {
    this.logger.warn(`${input.kind} → ${maskForLog(input.transport.payload.phone)} FALLITO`, {
      trasporto: input.transport.kind,
      code: error.code,
      retryable: error.retryable,
      message: error.message,
      correlationId: input.correlationId,
    });
    this.deps.activityLog.record({
      at: this.deps.clock.nowIso(),
      mode: this.config.mode,
      templateKind: input.kind,
      templateKey: input.templateKey,
      url: describeTarget(input.transport, this.config.apiBaseUrl),
      phoneMasked: maskForLog(input.transport.payload.phone),
      payload: payloadForLog(input.transport.payload),
      blockedBy: null,
      outcome: { ok: false, httpStatus, messageId: null, error: `${error.code}: ${error.message}` },
      correlationId: input.correlationId,
    });
    return err(error);
  }
}
