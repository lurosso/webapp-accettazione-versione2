// Adapter HTTP verso le automazioni Spoki. Due modalità:
// - `simulation` (predefinita): NESSUNA chiamata di rete. Il payload finisce nel log strutturato e
//   nel registro attività, la risposta è un 200 finto. Serve a provare tutto il flusso messaggi
//   senza consumare crediti WhatsApp né disturbare clienti veri;
// - `live`: POST JSON all'URL dell'automazione, con la chiave API nell'intestazione.
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
import { maskForLog, type SpokiTemplateKind, type SpokiWebhookPayload } from './spoki-config';

/** Sottoinsieme di `fetch` usato dall'adapter: iniettabile nei test. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface SpokiClientAdapterConfig {
  readonly mode: SpokiMode;
  readonly apiKey: string | null;
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
  /** URL dell'automazione; null solo in simulazione (si registra comunque). */
  readonly url: string | null;
  readonly payload: SpokiWebhookPayload;
  readonly correlationId: string;
  readonly options?: CallOptions | undefined;
}

export interface TriggerResult {
  readonly httpStatus: number;
  /** Identificativo restituito da Spoki, o generato in simulazione. */
  readonly messageId: string;
  readonly acceptedAt: IsoDateTime;
}

export class SpokiClientAdapter {
  private readonly logger: ILogger;

  constructor(
    private readonly config: SpokiClientAdapterConfig,
    private readonly deps: SpokiClientAdapterDeps,
  ) {
    this.logger = deps.logger.child(`[Spoki][${config.mode}]`);
  }

  get mode(): SpokiMode {
    return this.config.mode;
  }

  async trigger(input: TriggerInput): Promise<ProviderResult<TriggerResult>> {
    if (this.config.mode === 'simulation') {
      return this.simulate(input);
    }
    return this.callLive(input);
  }

  /** Simulazione: log strutturato del payload e 200 OK finto. Zero rete, zero crediti. */
  private simulate(input: TriggerInput): ProviderResult<TriggerResult> {
    const acceptedAt = this.deps.clock.nowIso();
    const messageId = `sim-${this.deps.ids.next()}`;
    this.logger.info(`SIMULAZIONE ${input.kind} → ${maskForLog(input.payload.phone)}`, {
      url: input.url ?? '(non configurato)',
      template: input.templateKey,
      payload: input.payload,
      correlationId: input.correlationId,
      risposta: { status: 200, messageId },
    });
    this.deps.activityLog.record({
      at: acceptedAt,
      mode: 'simulation',
      templateKind: input.kind,
      templateKey: input.templateKey,
      url: input.url,
      phoneMasked: maskForLog(input.payload.phone),
      payload: { ...input.payload },
      outcome: { ok: true, httpStatus: 200, messageId, error: null },
      correlationId: input.correlationId,
    });
    return ok({ httpStatus: 200, messageId, acceptedAt });
  }

  private async callLive(input: TriggerInput): Promise<ProviderResult<TriggerResult>> {
    if (input.url === null) {
      return this.fail(
        input,
        providerError(
          'SPOKI',
          'INVALID_REQUEST',
          `URL dell'automazione Spoki non configurato per ${input.kind}.`,
          false,
        ),
        null,
      );
    }
    if (this.config.apiKey === null) {
      return this.fail(
        input,
        providerError(
          'SPOKI',
          'AUTH',
          'SPOKI_API_KEY mancante: impossibile chiamare Spoki.',
          false,
        ),
        null,
      );
    }
    const fetchImpl = this.deps.fetchImpl;
    if (fetchImpl === undefined) {
      return this.fail(
        input,
        providerError('SPOKI', 'UNAVAILABLE', 'Nessun client HTTP disponibile per Spoki.', false),
        null,
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      input.options?.timeoutMs ?? this.config.timeoutMs,
    );
    input.options?.signal?.addEventListener('abort', () => controller.abort(), { once: true });
    try {
      const response = await fetchImpl(input.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
          'x-correlation-id': input.correlationId,
        },
        body: JSON.stringify(input.payload),
        signal: controller.signal,
      });
      const testo = await response.text().catch(() => '');
      if (!response.ok) {
        return this.fail(input, this.errorForStatus(response.status, testo), response.status);
      }
      const messageId = this.extractMessageId(testo) ?? `spoki-${this.deps.ids.next()}`;
      const acceptedAt = this.deps.clock.nowIso();
      this.logger.info(`${input.kind} → ${maskForLog(input.payload.phone)} accettato`, {
        status: response.status,
        messageId,
        correlationId: input.correlationId,
      });
      this.deps.activityLog.record({
        at: acceptedAt,
        mode: 'live',
        templateKind: input.kind,
        templateKey: input.templateKey,
        url: input.url,
        phoneMasked: maskForLog(input.payload.phone),
        payload: { ...input.payload },
        outcome: { ok: true, httpStatus: response.status, messageId, error: null },
        correlationId: input.correlationId,
      });
      return ok({ httpStatus: response.status, messageId, acceptedAt });
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

  private errorForStatus(status: number, body: string): ProviderError {
    const dettaglio = body.trim() === '' ? '' : ` (${body.trim().slice(0, 200)})`;
    if (status === 401 || status === 403) {
      return providerError('SPOKI', 'AUTH', `Spoki ha rifiutato la chiave API${dettaglio}.`, false);
    }
    if (status === 404) {
      return providerError(
        'SPOKI',
        'NOT_FOUND',
        `Automazione Spoki non trovata: controlla l'URL${dettaglio}.`,
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

  /** Spoki può rispondere con `id`, `message_id` o `messageId`: si accetta il primo presente. */
  private extractMessageId(body: string): string | null {
    try {
      const parsed: unknown = JSON.parse(body);
      if (typeof parsed !== 'object' || parsed === null) {
        return null;
      }
      const record = parsed as Record<string, unknown>;
      for (const key of ['id', 'message_id', 'messageId']) {
        const value = record[key];
        if (typeof value === 'string' && value !== '') {
          return value;
        }
        if (typeof value === 'number') {
          return String(value);
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  private fail(
    input: TriggerInput,
    error: ProviderError,
    httpStatus: number | null,
  ): ProviderResult<TriggerResult> {
    this.logger.warn(`${input.kind} → ${maskForLog(input.payload.phone)} FALLITO`, {
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
      url: input.url,
      phoneMasked: maskForLog(input.payload.phone),
      payload: { ...input.payload },
      outcome: { ok: false, httpStatus, messageId: null, error: `${error.code}: ${error.message}` },
      correlationId: input.correlationId,
    });
    return err(error);
  }
}
