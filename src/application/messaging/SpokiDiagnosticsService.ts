// Diagnostica dell'integrazione WhatsApp per il pannello di amministrazione: com'è configurata
// (provider, modalità, chiave, URL dei template), cosa ha inviato o simulato finora, e un invio
// di prova verso un numero scelto a mano. Dipende solo dalle porte: con il mock, il servizio reale
// in simulazione o quello live cambia solo quello che si legge nel registro.
import type { NotificationKind } from '@/domain/entities/notification';
import { domainError, type DomainError } from '@/domain/errors';
import { err, ok, type Result } from '@/domain/result';
import { parsePhoneE164 } from '@/domain/value-objects/phone';
import type { SendReceipt } from '@/services/interfaces/common';
import type { IIdGenerator } from '@/services/interfaces/IIdGenerator';
import type { ILogger } from '@/services/interfaces/ILogger';
import type {
  ISpokiActivityLog,
  SpokiActivityEntry,
} from '@/services/interfaces/ISpokiActivityLog';
import type { ISpokiService } from '@/services/interfaces/ISpokiService';
import type { ProviderKind, SpokiMode } from '@/services/interfaces/provider-kinds';
import {
  buildPortalUrl,
  NOTIFICATION_TEMPLATES,
  type TemplateVars,
} from '../notifications/templates';

/** Tipi di messaggio provabili dal pannello: quelli che hanno un'automazione Spoki. */
export const SPOKI_TEST_KINDS = [
  'BOOKING_CONFIRMED',
  'TURN_APPROACHING',
  'APPOINTMENT_CANCELLED',
] as const satisfies readonly NotificationKind[];

export type SpokiTestKind = (typeof SPOKI_TEST_KINDS)[number];

export interface SpokiTemplateStatus {
  readonly kind: 'CONFIRMATION' | 'TURN_APPROACHING' | 'CANCELLATION';
  readonly notificationKind: SpokiTestKind;
  readonly envKey: string;
  readonly configured: boolean;
  /** URL con il percorso accorciato: l'amministratore deve riconoscerlo, non copiarlo da qui. */
  readonly urlPreview: string | null;
}

export interface SpokiOverview {
  readonly provider: ProviderKind;
  readonly mode: SpokiMode;
  readonly apiKeyConfigured: boolean;
  readonly apiKeyMasked: string | null;
  readonly templates: readonly SpokiTemplateStatus[];
  readonly publicBaseUrl: string;
  readonly log: readonly SpokiActivityEntry[];
}

export interface SpokiDiagnosticsConfig {
  readonly provider: ProviderKind;
  readonly mode: SpokiMode;
  readonly apiKey: string | null;
  readonly urls: {
    readonly confirmation: string | null;
    readonly turnApproaching: string | null;
    readonly cancellation: string | null;
  };
  readonly publicBaseUrl: string;
}

export interface SpokiDiagnosticsDeps {
  readonly spoki: ISpokiService;
  readonly activityLog: ISpokiActivityLog;
  readonly config: SpokiDiagnosticsConfig;
  readonly ids: IIdGenerator;
  readonly logger: ILogger;
}

export interface SpokiTestInput {
  readonly phone: string;
  readonly kind: SpokiTestKind;
  /** Nome del destinatario nel messaggio di prova (default "Test"). */
  readonly firstName?: string | undefined;
}

export interface SpokiTestResult {
  readonly receipt: SendReceipt;
  readonly renderedText: string;
  readonly templateKey: string;
}

function maskKey(key: string): string {
  return key.length <= 6 ? '••••' : `${key.slice(0, 3)}••••${key.slice(-3)}`;
}

function previewUrl(url: string | null): string | null {
  if (url === null) {
    return null;
  }
  try {
    const u = new URL(url);
    const path =
      u.pathname.length > 24 ? `${u.pathname.slice(0, 12)}…${u.pathname.slice(-8)}` : u.pathname;
    return `${u.host}${path}`;
  } catch {
    return url.length > 40 ? `${url.slice(0, 40)}…` : url;
  }
}

export class SpokiDiagnosticsService {
  private readonly logger: ILogger;

  constructor(private readonly deps: SpokiDiagnosticsDeps) {
    this.logger = deps.logger.child('[Spoki][Diagnostica]');
  }

  overview(limit = 100): SpokiOverview {
    const c = this.deps.config;
    return {
      provider: c.provider,
      mode: c.mode,
      apiKeyConfigured: c.apiKey !== null,
      apiKeyMasked: c.apiKey === null ? null : maskKey(c.apiKey),
      templates: [
        {
          kind: 'CONFIRMATION',
          notificationKind: 'BOOKING_CONFIRMED',
          envKey: 'SPOKI_URL_CONFIRMATION',
          configured: c.urls.confirmation !== null,
          urlPreview: previewUrl(c.urls.confirmation),
        },
        {
          kind: 'TURN_APPROACHING',
          notificationKind: 'TURN_APPROACHING',
          envKey: 'SPOKI_URL_TURN_APPROACHING',
          configured: c.urls.turnApproaching !== null,
          urlPreview: previewUrl(c.urls.turnApproaching),
        },
        {
          kind: 'CANCELLATION',
          notificationKind: 'APPOINTMENT_CANCELLED',
          envKey: 'SPOKI_URL_CANCELLATION',
          configured: c.urls.cancellation !== null,
          urlPreview: previewUrl(c.urls.cancellation),
        },
      ],
      publicBaseUrl: c.publicBaseUrl,
      log: this.deps.activityLog.list(limit),
    };
  }

  /**
   * Invio di prova a un numero scelto a mano, con dati fittizi (pratica F999, targa AB123CD).
   * Passa dalla stessa porta dei messaggi veri: in simulazione finisce nel registro, in live
   * consuma un messaggio WhatsApp reale (il pannello lo dice prima del pulsante).
   */
  async sendTest(
    input: SpokiTestInput,
    actor: { readonly operatorId: string },
  ): Promise<Result<SpokiTestResult, DomainError>> {
    const phone = parsePhoneE164(input.phone);
    if (!phone.ok) {
      return phone;
    }
    const template = NOTIFICATION_TEMPLATES[input.kind];
    const vars: TemplateVars = {
      firstName: input.firstName ?? 'Test',
      code: 'F999',
      scheduledTime: '09:30',
      plate: 'AB123CD',
      brandName: 'Autoclub Group',
      portalUrl: buildPortalUrl(this.deps.config.publicBaseUrl, 'AB123CD'),
    };
    const text = template.render(vars);
    const correlationId = this.deps.ids.next();
    const esito = await this.deps.spoki.sendTemplateMessage(
      {
        idempotencyKey: `test:${correlationId}`,
        to: phone.value,
        templateKey: template.spokiTemplateKey,
        variables: { ...vars, text },
        correlationId,
      },
      { correlationId },
    );
    if (!esito.ok) {
      this.logger.warn('invio di prova fallito', {
        code: esito.error.code,
        message: esito.error.message,
        operatorId: actor.operatorId,
      });
      return err(
        domainError('VALIDATION', `Invio di prova non riuscito: ${esito.error.message}`, {
          providerCode: esito.error.code,
          retryable: esito.error.retryable,
        }),
      );
    }
    this.logger.info('invio di prova eseguito', {
      kind: input.kind,
      operatorId: actor.operatorId,
      providerMessageId: esito.value.providerMessageId,
    });
    return ok({ receipt: esito.value, renderedText: text, templateKey: template.spokiTemplateKey });
  }
}
