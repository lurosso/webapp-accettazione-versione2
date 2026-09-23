// Diagnostica dell'integrazione WhatsApp per il pannello di amministrazione: com'è configurata
// (provider, modalità, blocco di sicurezza, chiave, URL e segreti dei due promemoria), cosa ha
// inviato o simulato finora, e un invio di prova verso un numero scelto a mano. Dipende solo dalle
// porte: con il mock, il servizio reale in simulazione o quello live cambia solo quello che si
// legge nel registro.
//
// GUARDRAIL del test manuale: il numero deve essere digitato dall'operatore e NON può essere quello
// di un cliente presente in agenda (oggi o domani): la prova si fa su un telefono interno.
import type { NotificationKind } from '@/domain/entities/notification';
import { domainError, type DomainError } from '@/domain/errors';
import { err, ok, type Result } from '@/domain/result';
import type { IsoDate } from '@/domain/value-objects/iso-date';
import { parsePhoneE164 } from '@/domain/value-objects/phone';
import { addDays, formatBusinessDateIt } from '@/lib/dates';
import type { IAppointmentRepository } from '@/repositories/interfaces';
import type { SendReceipt } from '@/services/interfaces/common';
import type { IClock } from '@/services/interfaces/IClock';
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

/** Tipi di messaggio provabili dal pannello: promemoria, risposte ai pulsanti e messaggi del check-in. */
export const SPOKI_TEST_KINDS = [
  'REMINDER_PREVIOUS_DAY',
  'REMINDER_SAME_DAY',
  'ARRIVAL_CONFIRMED',
  'LATE_CONFIRMED',
  'ABSENT_CONFIRMED',
  'CHECK_IN_STARTED',
  'CHECK_IN_COMPLETED',
] as const satisfies readonly NotificationKind[];

export type SpokiTestKind = (typeof SPOKI_TEST_KINDS)[number];

/**
 * Perché nessun WhatsApp reale può partire; null se può. DISABLED = SPOKI_ENABLED=false: la
 * modalità effettiva è la simulazione qualunque cosa dica SPOKI_MODE.
 */
export type SpokiBlockReason = 'MOCK_PROVIDER' | 'DISABLED' | 'SIMULATION' | 'SAFETY_LOCK' | null;

/** Com'è configurato un template: automazione (URL + segreto) oppure template via API (id). */
export type SpokiTemplateStatus =
  | {
      readonly kind: SpokiTestKind;
      readonly label: string;
      readonly transport: 'AUTOMATION';
      readonly urlEnvKey: string;
      readonly secretEnvKey: string;
      readonly urlConfigured: boolean;
      readonly secretConfigured: boolean;
      /** URL con il percorso accorciato: l'amministratore deve riconoscerlo, non copiarlo da qui. */
      readonly urlPreview: string | null;
    }
  | {
      readonly kind: SpokiTestKind;
      readonly label: string;
      readonly transport: 'TEMPLATE';
      readonly templateEnvKey: string;
      readonly templateConfigured: boolean;
      /** Id del template: non è un segreto, si può mostrare. */
      readonly templateId: string | null;
    };

export interface SpokiOverview {
  readonly provider: ProviderKind;
  /** SPOKI_ENABLED: l'interruttore dell'integrazione. */
  readonly enabled: boolean;
  readonly mode: SpokiMode;
  readonly safetyLock: boolean;
  /** SPOKI_WEBHOOK_SECRET presente: gli esiti di consegna vengono accettati e verificati. */
  readonly webhookSecretConfigured: boolean;
  /** Indirizzo pubblico a cui puntare i webhook V2 in Spoki (Integrazioni → Webhook). */
  readonly webhookUrl: string;
  /** SPOKI_OVERRIDE_CONSENT: promemoria WhatsApp tentati anche senza opt-in in anagrafica. */
  readonly consentOverride: boolean;
  /** True solo con provider real, modalità live e blocco tolto. */
  readonly liveDeliveryAllowed: boolean;
  readonly blockReason: SpokiBlockReason;
  readonly apiKeyConfigured: boolean;
  readonly apiKeyMasked: string | null;
  readonly templates: readonly SpokiTemplateStatus[];
  readonly publicBaseUrl: string;
  readonly reminderPreviousDayHourLocal: string;
  readonly reminderSameDayHourLocal: string;
  readonly remindersEnabled: boolean;
  /** MESSAGING_STANDBY: l'integrazione con il cliente è in pausa, di proposito. */
  readonly standby: boolean;
  readonly log: readonly SpokiActivityEntry[];
}

export interface SpokiReminderTemplateConfig {
  readonly url: string | null;
  readonly secret: string | null;
}

export interface SpokiDiagnosticsConfig {
  readonly provider: ProviderKind;
  /** SPOKI_ENABLED (facoltativo nei test: assente = acceso, così i test vecchi non cambiano). */
  readonly enabled?: boolean;
  readonly mode: SpokiMode;
  readonly safetyLock: boolean;
  /** SPOKI_WEBHOOK_SECRET presente (facoltativo nei test). */
  readonly webhookSecretConfigured?: boolean;
  /** Id dei template via API (facoltativo nei test); i promemoria con id partono via API. */
  readonly templateIds?: {
    readonly reminderPreviousDay?: string | null;
    readonly reminderSameDay?: string | null;
    readonly arrivalConfirmed?: string | null;
    readonly lateConfirmed?: string | null;
    readonly absentConfirmed?: string | null;
    readonly checkInStarted: string | null;
    readonly checkInCompleted: string | null;
  };
  /** SPOKI_OVERRIDE_CONSENT (facoltativo nei test). */
  readonly consentOverride?: boolean;
  readonly apiKey: string | null;
  readonly reminders: {
    readonly previousDay: SpokiReminderTemplateConfig;
    readonly sameDay: SpokiReminderTemplateConfig;
  };
  readonly publicBaseUrl: string;
  readonly reminderPreviousDayHourLocal: string;
  readonly reminderSameDayHourLocal: string;
  readonly remindersEnabled: boolean;
  /** MESSAGING_STANDBY (facoltativo nei test). */
  readonly standby?: boolean;
}

export interface SpokiDiagnosticsDeps {
  readonly spoki: ISpokiService;
  readonly activityLog: ISpokiActivityLog;
  readonly config: SpokiDiagnosticsConfig;
  readonly ids: IIdGenerator;
  readonly clock: IClock;
  readonly logger: ILogger;
  /** Per rifiutare i numeri dei clienti reali in agenda; facoltativo nei test. */
  readonly appointments?: IAppointmentRepository;
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
  /** True quando la chiamata è stata solo formattata e registrata (mock, simulazione o blocco). */
  readonly dryRun: boolean;
  readonly blockReason: SpokiBlockReason;
}

export const SPOKI_TEST_KIND_LABELS: Readonly<Record<SpokiTestKind, string>> = {
  REMINDER_PREVIOUS_DAY: 'Promemoria giorno prima',
  REMINDER_SAME_DAY: 'Promemoria giorno stesso (con pulsanti)',
  ARRIVAL_CONFIRMED: 'Risposta a «Sono arrivato» (codice e smart link)',
  LATE_CONFIRMED: 'Risposta a «In ritardo»',
  ABSENT_CONFIRMED: 'Risposta a «Non posso venire»',
  CHECK_IN_STARTED: 'Presa in carico (link al portale)',
  CHECK_IN_COMPLETED: 'Accettazione completata',
};

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

/**
 * Regola del guardrail vista dal pannello: stessa dell'adapter, più il caso provider mock e
 * l'interruttore spento, che forza la simulazione a monte.
 */
export function spokiBlockReason(
  provider: ProviderKind,
  mode: SpokiMode,
  safetyLock: boolean,
  enabled = true,
): SpokiBlockReason {
  if (provider !== 'real') {
    return 'MOCK_PROVIDER';
  }
  if (!enabled) {
    return 'DISABLED';
  }
  if (mode !== 'live') {
    return 'SIMULATION';
  }
  return safetyLock ? 'SAFETY_LOCK' : null;
}

export class SpokiDiagnosticsService {
  private readonly logger: ILogger;

  constructor(private readonly deps: SpokiDiagnosticsDeps) {
    this.logger = deps.logger.child('[Spoki][Diagnostica]');
  }

  overview(limit = 100): SpokiOverview {
    const c = this.deps.config;
    const enabled = c.enabled ?? true;
    const blockReason = spokiBlockReason(c.provider, c.mode, c.safetyLock, enabled);
    const automazione = (
      kind: SpokiTestKind,
      cfg: SpokiReminderTemplateConfig,
      suffix: string,
    ): SpokiTemplateStatus => ({
      kind,
      label: SPOKI_TEST_KIND_LABELS[kind],
      transport: 'AUTOMATION',
      urlEnvKey: `SPOKI_URL_${suffix}`,
      secretEnvKey: `SPOKI_SECRET_${suffix}`,
      urlConfigured: cfg.url !== null,
      secretConfigured: cfg.secret !== null,
      urlPreview: previewUrl(cfg.url),
    });
    const template = (
      kind: SpokiTestKind,
      templateEnvKey: string,
      templateId: string | null,
    ): SpokiTemplateStatus => ({
      kind,
      label: SPOKI_TEST_KIND_LABELS[kind],
      transport: 'TEMPLATE',
      templateEnvKey,
      templateConfigured: templateId !== null,
      templateId,
    });
    return {
      provider: c.provider,
      enabled,
      mode: c.mode,
      safetyLock: c.safetyLock,
      webhookSecretConfigured: c.webhookSecretConfigured === true,
      webhookUrl: `${c.publicBaseUrl}/api/v1/webhooks/spoki`,
      consentOverride: c.consentOverride === true,
      liveDeliveryAllowed: blockReason === null,
      blockReason,
      apiKeyConfigured: c.apiKey !== null,
      apiKeyMasked: c.apiKey === null ? null : maskKey(c.apiKey),
      templates: [
        // Stessa regola del servizio (`resolveTransportKind`): l'id del template vince; senza id
        // ma con l'URL si resta sull'automazione; senza nessuno dei due il promemoria è un template
        // via API da configurare. Pannello, stato di salute e invio indicano la stessa variabile.
        c.templateIds?.reminderPreviousDay != null || c.reminders.previousDay.url === null
          ? template(
              'REMINDER_PREVIOUS_DAY',
              'SPOKI_TEMPLATE_REMINDER_D1_ID',
              c.templateIds?.reminderPreviousDay ?? null,
            )
          : automazione('REMINDER_PREVIOUS_DAY', c.reminders.previousDay, 'REMINDER_PREVIOUS_DAY'),
        c.templateIds?.reminderSameDay != null || c.reminders.sameDay.url === null
          ? template(
              'REMINDER_SAME_DAY',
              'SPOKI_TEMPLATE_SAME_DAY_ID',
              c.templateIds?.reminderSameDay ?? null,
            )
          : automazione('REMINDER_SAME_DAY', c.reminders.sameDay, 'REMINDER_SAME_DAY'),
        template(
          'ARRIVAL_CONFIRMED',
          'SPOKI_TEMPLATE_ARRIVED_REPLY_ID',
          c.templateIds?.arrivalConfirmed ?? null,
        ),
        template(
          'LATE_CONFIRMED',
          'SPOKI_TEMPLATE_LATE_REPLY_ID',
          c.templateIds?.lateConfirmed ?? null,
        ),
        template(
          'ABSENT_CONFIRMED',
          'SPOKI_TEMPLATE_ABSENT_REPLY_ID',
          c.templateIds?.absentConfirmed ?? null,
        ),
        template(
          'CHECK_IN_STARTED',
          'SPOKI_TEMPLATE_WELCOME_ID',
          c.templateIds?.checkInStarted ?? null,
        ),
        template(
          'CHECK_IN_COMPLETED',
          'SPOKI_TEMPLATE_COMPLETE_ID',
          c.templateIds?.checkInCompleted ?? null,
        ),
      ],
      publicBaseUrl: c.publicBaseUrl,
      reminderPreviousDayHourLocal: c.reminderPreviousDayHourLocal,
      reminderSameDayHourLocal: c.reminderSameDayHourLocal,
      remindersEnabled: c.remindersEnabled,
      standby: c.standby === true,
      log: this.deps.activityLog.list(limit),
    };
  }

  /**
   * Invio di prova a un numero scelto a mano, con dati fittizi (pratica F999, targa AB123CD).
   * Passa dalla stessa porta dei messaggi veri: con il blocco attivo finisce nel registro; senza
   * blocco e in live consuma un messaggio WhatsApp reale (il pannello lo dice prima del pulsante).
   * Il numero di un cliente in agenda (oggi o domani) viene rifiutato: la prova non deve
   * raggiungere clienti veri per errore.
   */
  async sendTest(
    input: SpokiTestInput,
    actor: { readonly operatorId: string },
  ): Promise<Result<SpokiTestResult, DomainError>> {
    const phone = parsePhoneE164(input.phone);
    if (!phone.ok) {
      return phone;
    }
    if (await this.belongsToRealCustomer(phone.value)) {
      this.logger.warn('invio di prova rifiutato: numero di un cliente in agenda', {
        operatorId: actor.operatorId,
      });
      return err(
        domainError(
          'VALIDATION',
          'Il numero appartiene a un cliente presente in agenda: il messaggio di prova va inviato solo a un telefono interno digitato a mano.',
        ),
      );
    }
    const today = this.deps.clock.today();
    const giornata: IsoDate = input.kind === 'REMINDER_PREVIOUS_DAY' ? addDays(today, 1) : today;
    const template = NOTIFICATION_TEMPLATES[input.kind];
    const vars: TemplateVars = {
      firstName: input.firstName ?? 'Test',
      lastName: 'Prova',
      email: '',
      code: 'F999',
      scheduledTime: '09:30',
      scheduledDate: formatBusinessDateIt(giornata),
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
    const c = this.deps.config;
    const blockReason = spokiBlockReason(c.provider, c.mode, c.safetyLock, c.enabled ?? true);
    this.logger.info('invio di prova eseguito', {
      kind: input.kind,
      operatorId: actor.operatorId,
      providerMessageId: esito.value.providerMessageId,
      dryRun: blockReason !== null,
    });
    return ok({
      receipt: esito.value,
      renderedText: text,
      templateKey: template.spokiTemplateKey,
      dryRun: blockReason !== null,
      blockReason,
    });
  }

  /** Il numero è quello di un cliente con una pratica oggi o domani? */
  private async belongsToRealCustomer(phone: string): Promise<boolean> {
    const repo = this.deps.appointments;
    if (repo === undefined) {
      return false;
    }
    const today = this.deps.clock.today();
    const [oggi, domani] = await Promise.all([
      repo.listByDate(today, { includeCancelled: true, flow: 'ALL' }),
      repo.listByDate(addDays(today, 1), { includeCancelled: true, flow: 'ALL' }),
    ]);
    return [...oggi, ...domani].some((a) => a.customer.phone === phone);
  }
}
