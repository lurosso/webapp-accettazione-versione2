// Orchestratore delle notifiche: WhatsApp (Spoki) → SMS (SMS Hosting) → FAILED/MANUAL_REQUIRED.
// Logica REALE, mai mockata: dipende solo da interfacce. Idempotente per idempotencyKey,
// registra un NotificationAttempt per ogni chiamata, pubblica NOTIFICATION_JOB_CHANGED
// e non lancia mai eccezioni.

import { NOTIFICATION_IN_FLIGHT_STALE_MS } from '@/config/constants';
import type { Appointment } from '@/domain/entities/appointment';
import type { Brand } from '@/domain/entities/brand';
import type {
  NotificationAttempt,
  NotificationChannel,
  NotificationJob,
  NotificationKind,
  NotificationProvider,
} from '@/domain/entities/notification';
import { buildNotificationIdempotencyKey } from '@/domain/entities/notification';
import type { DomainError } from '@/domain/errors';
import { domainError } from '@/domain/errors';
import type { NotificationJobId, OperatorId } from '@/domain/ids';
import { asNotificationAttemptId, asNotificationJobId } from '@/domain/ids';
import type { Result } from '@/domain/result';
import { err, ok } from '@/domain/result';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import type { PhoneE164 } from '@/domain/value-objects/phone';
import type { INotificationRepository } from '@/repositories/interfaces/INotificationRepository';
import type { ProviderError, SendReceipt } from '@/services/interfaces/common';
import type { IClock } from '@/services/interfaces/IClock';
import type { IEventBus } from '@/services/interfaces/IEventBus';
import type { IIdGenerator } from '@/services/interfaces/IIdGenerator';
import type { ILogger } from '@/services/interfaces/ILogger';
import type { ISmsHostingService } from '@/services/interfaces/ISmsHostingService';
import type { ISpokiService } from '@/services/interfaces/ISpokiService';
import { buildTemplateVars, NOTIFICATION_TEMPLATES } from './templates';

/**
 * Esito leggibile dell'orchestrazione.
 * - FAILED_RETRYABLE: entrambi i canali hanno fallito con errori `retryable` (es. timeout):
 *   il job resta FAILED, sarà ritentato con backoff da M3 e intanto è confermabile a mano.
 * - MANUAL_REQUIRED: fallimento non retryable (o errore inatteso): serve il contatto manuale.
 */
export type NotificationOutcome =
  | { readonly kind: 'WHATSAPP_SENT' }
  | { readonly kind: 'SMS_FALLBACK_SENT' }
  | { readonly kind: 'FAILED_RETRYABLE' }
  | { readonly kind: 'MANUAL_REQUIRED' }
  | { readonly kind: 'NO_RECIPIENT' }
  | { readonly kind: 'ALREADY_PROCESSED' };

/** Dipendenze (solo interfacce). */
export interface NotificationOrchestratorDeps {
  readonly spoki: ISpokiService;
  readonly smsHosting: ISmsHostingService;
  readonly notifications: INotificationRepository;
  readonly clock: IClock;
  readonly ids: IIdGenerator;
  readonly logger: ILogger;
  readonly eventBus: IEventBus;
  /** Fuso per l'orario nel testo (default Europe/Rome). */
  readonly timeZone?: string;
  /** Dopo quanti ms un job IN_FLIGHT è considerato orfano e riprocessabile (default 5 minuti). */
  readonly inFlightStaleMs?: number;
}

/** Input dell'invio di un promemoria. */
export interface SendReminderInput {
  readonly appointment: Appointment;
  readonly brand: Brand;
  readonly kind: NotificationKind;
  readonly correlationId: string;
}

/** Job + esito. */
export interface NotificationRun {
  readonly job: NotificationJob;
  readonly outcome: NotificationOutcome;
}

interface AttemptInput {
  readonly channel: NotificationChannel;
  readonly provider: NotificationProvider;
  readonly providerMessageId: string | null;
  readonly outcome: NotificationAttempt['outcome'];
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly retryable: boolean;
  readonly requestedAt: IsoDateTime;
}

/** Orchestratore WhatsApp → SMS → contatto manuale. */
export class NotificationOrchestrator {
  private readonly logger: ILogger;
  private readonly inFlightStaleMs: number;

  constructor(private readonly deps: NotificationOrchestratorDeps) {
    this.logger = deps.logger.child('[Notifications]');
    this.inFlightStaleMs = deps.inFlightStaleMs ?? NOTIFICATION_IN_FLIGHT_STALE_MS;
  }

  /**
   * Invia (o riprende) il messaggio `kind` per la pratica. Idempotente: un job già
   * processato (stato diverso da PENDING/FAILED o IN_FLIGHT orfano) restituisce ALREADY_PROCESSED.
   * Un job IN_FLIGHT più vecchio di `inFlightStaleMs` (crash prima del completamento) viene
   * ripreso: dopo un riavvio nessuna notifica resta bloccata senza fallback.
   */
  async sendReminder(input: SendReminderInput): Promise<NotificationRun> {
    const { appointment, brand, kind, correlationId } = input;
    const idempotencyKey = buildNotificationIdempotencyKey(
      appointment.id,
      kind,
      appointment.businessDate,
    );
    const vars = buildTemplateVars(appointment, brand, this.deps.timeZone);
    const renderedText = NOTIFICATION_TEMPLATES[kind].render(vars);
    const now = this.deps.clock.nowIso();
    const draft: NotificationJob = {
      id: this.deps.ids.nextAs(asNotificationJobId),
      appointmentId: appointment.id,
      businessDate: appointment.businessDate,
      kind,
      idempotencyKey,
      recipientPhone: appointment.customer.phone,
      whatsappOptIn: appointment.customer.whatsappOptIn,
      code: appointment.code,
      templateVariables: { ...vars },
      renderedText,
      status: 'PENDING',
      currentChannel: null,
      attempts: [],
      manualConfirmedBy: null,
      manualNote: null,
      createdAt: now,
      updatedAt: now,
    };

    let job: NotificationJob = draft;
    try {
      const existing = await this.deps.notifications.findJobByIdempotencyKey(idempotencyKey);
      if (existing !== null && !this.isReprocessable(existing)) {
        this.logger.debug('job già processato', { idempotencyKey, status: existing.status });
        return { job: existing, outcome: { kind: 'ALREADY_PROCESSED' } };
      }
      job = existing ?? (await this.deps.notifications.insertJob(draft));

      if (job.recipientPhone === null) {
        const updated = await this.persist({ ...job, status: 'NO_RECIPIENT' }, correlationId, true);
        this.logger.warn('nessun recapito telefonico: notifica non inviabile', {
          appointmentId: appointment.id,
          code: appointment.code,
        });
        return { job: updated, outcome: { kind: 'NO_RECIPIENT' } };
      }

      return await this.process(job, job.recipientPhone, job.whatsappOptIn, correlationId);
    } catch (cause) {
      return this.failSafe(job, correlationId, cause);
    }
  }

  /**
   * Promemoria del mattino per un elenco di pratiche, subito dopo la sincronizzazione dell'agenda
   * (requisito: "messaggio WhatsApp automatico inviato la mattina post-sync").
   *
   * Gli invii sono in sequenza, non in parallelo: un provider reale limita la frequenza e
   * l'officina non ha fretta di svuotare la coda dei messaggi. Un errore su una pratica non
   * interrompe le altre: ogni esito è registrato sul proprio job e confermabile a mano.
   */
  async sendMorningReminders(input: {
    readonly appointments: readonly Appointment[];
    readonly brands: readonly Brand[];
    readonly correlationId: string;
  }): Promise<readonly NotificationRun[]> {
    const runs: NotificationRun[] = [];
    for (const appointment of input.appointments) {
      const brand = input.brands.find((b) => b.id === appointment.brandId);
      if (brand === undefined) {
        this.logger.warn('promemoria non inviato: marchio sconosciuto', {
          code: appointment.code,
          brandId: appointment.brandId,
        });
        continue;
      }
      runs.push(
        await this.sendReminder({
          appointment,
          brand,
          kind: 'REMINDER_MORNING',
          correlationId: input.correlationId,
        }),
      );
    }

    const conteggio = (kind: NotificationOutcome['kind']): number =>
      runs.filter((r) => r.outcome.kind === kind).length;
    this.logger.info(
      `promemoria del mattino: ${runs.length} pratiche elaborate ` +
        `(WhatsApp ${conteggio('WHATSAPP_SENT')}, SMS di ripiego ${conteggio('SMS_FALLBACK_SENT')}, ` +
        `da ritentare ${conteggio('FAILED_RETRYABLE')}, da contattare a mano ${conteggio('MANUAL_REQUIRED')}, ` +
        `senza recapito ${conteggio('NO_RECIPIENT')}, già inviate ${conteggio('ALREADY_PROCESSED')})`,
    );
    return runs;
  }

  /** Il supervisor conferma di aver contattato il cliente a mano. */
  async confirmManual(
    jobId: NotificationJobId,
    operatorId: OperatorId,
    note: string,
  ): Promise<Result<NotificationJob, DomainError>> {
    try {
      const job = await this.deps.notifications.findJobById(jobId);
      if (job === null) {
        return err(domainError('NOT_FOUND', `Notifica non trovata: ${jobId}.`));
      }
      if (
        job.status !== 'MANUAL_REQUIRED' &&
        job.status !== 'FAILED' &&
        job.status !== 'NO_RECIPIENT'
      ) {
        return err(
          domainError(
            'INVALID_TRANSITION',
            `La notifica è in stato ${job.status}: la conferma manuale è ammessa solo da MANUAL_REQUIRED, FAILED o NO_RECIPIENT.`,
            { status: job.status },
          ),
        );
      }
      const attempt = this.buildAttempt(job, {
        channel: 'MANUAL',
        provider: 'NONE',
        providerMessageId: null,
        outcome: 'DELIVERED',
        errorCode: null,
        errorMessage: null,
        retryable: false,
        requestedAt: this.deps.clock.nowIso(),
      });
      const updated = await this.persist(
        {
          ...job,
          status: 'MANUAL_CONFIRMED',
          currentChannel: 'MANUAL',
          attempts: [...job.attempts, attempt],
          manualConfirmedBy: operatorId,
          manualNote: note.trim().length > 0 ? note.trim() : null,
        },
        `manual-confirm:${jobId}`,
        true,
        { kind: 'OPERATOR', id: operatorId },
      );
      return ok(updated);
    } catch (cause) {
      this.logger.error('confirmManual fallita', { jobId, cause });
      return err(domainError('INTERNAL', 'Impossibile registrare la conferma manuale.', { jobId }));
    }
  }

  /**
   * Riprova un job FAILED, MANUAL_REQUIRED o IN_FLIGHT orfano ripercorrendo la catena dei canali.
   * WhatsApp viene ritentato in base all'opt-in persistito sul job, non ai tentativi precedenti.
   */
  async retry(jobId: NotificationJobId): Promise<Result<NotificationRun, DomainError>> {
    let job: NotificationJob | null = null;
    try {
      job = await this.deps.notifications.findJobById(jobId);
      if (job === null) {
        return err(domainError('NOT_FOUND', `Notifica non trovata: ${jobId}.`));
      }
      const retryable =
        job.status === 'FAILED' || job.status === 'MANUAL_REQUIRED' || this.isStaleInFlight(job);
      if (!retryable) {
        return err(
          domainError(
            'INVALID_TRANSITION',
            `La notifica è in stato ${job.status}: nessun retry possibile.`,
            {
              status: job.status,
            },
          ),
        );
      }
      if (job.recipientPhone === null) {
        return err(domainError('NO_RECIPIENT', 'La pratica non ha un recapito telefonico.'));
      }
      const run = await this.process(job, job.recipientPhone, job.whatsappOptIn, `retry:${jobId}`);
      return ok(run);
    } catch (cause) {
      if (job === null) {
        return err(domainError('INTERNAL', 'Retry non riuscito.', { jobId }));
      }
      return ok(await this.failSafe(job, `retry:${jobId}`, cause));
    }
  }

  /** PENDING e FAILED sono sempre riprocessabili; IN_FLIGHT solo se orfano (crash). */
  private isReprocessable(job: NotificationJob): boolean {
    return job.status === 'PENDING' || job.status === 'FAILED' || this.isStaleInFlight(job);
  }

  private isStaleInFlight(job: NotificationJob): boolean {
    if (job.status !== 'IN_FLIGHT') {
      return false;
    }
    const ageMs = this.deps.clock.now().getTime() - new Date(job.updatedAt).getTime();
    return ageMs >= this.inFlightStaleMs;
  }

  /** Catena WhatsApp → SMS → FAILED/MANUAL_REQUIRED su un job già persistito. */
  private async process(
    job: NotificationJob,
    phone: PhoneE164,
    tryWhatsApp: boolean,
    correlationId: string,
  ): Promise<NotificationRun> {
    let current = await this.persist({ ...job, status: 'IN_FLIGHT' }, correlationId, false);
    const template = NOTIFICATION_TEMPLATES[current.kind];

    if (tryWhatsApp) {
      const attemptNo = current.attempts.length + 1;
      const requestedAt = this.deps.clock.nowIso();
      const sent = await this.deps.spoki.sendTemplateMessage(
        {
          idempotencyKey: `${current.idempotencyKey}:WA:${attemptNo}`,
          to: phone,
          templateKey: template.spokiTemplateKey,
          // Variabili del template Meta: il codice è il progressivo F001, mai l'id tecnico.
          variables: {
            ...current.templateVariables,
            code: current.code,
            text: current.renderedText,
          },
          correlationId,
        },
        { correlationId },
      );

      if (sent.ok) {
        const delivery = await this.deps.spoki.getDeliveryStatus(sent.value.providerMessageId, {
          correlationId,
        });
        const undeliverable =
          delivery.ok &&
          (delivery.value.state === 'UNDELIVERABLE' || delivery.value.state === 'FAILED');
        const delivered =
          delivery.ok && (delivery.value.state === 'DELIVERED' || delivery.value.state === 'READ');
        const attempt = this.buildAttempt(current, {
          channel: 'WHATSAPP',
          provider: 'SPOKI',
          providerMessageId: sent.value.providerMessageId,
          outcome: undeliverable ? 'FAILED' : delivered ? 'DELIVERED' : 'SENT',
          errorCode: undeliverable ? 'UNDELIVERABLE' : null,
          errorMessage: undeliverable && delivery.ok ? delivery.value.reason : null,
          retryable: false,
          requestedAt,
        });
        current = {
          ...current,
          attempts: [...current.attempts, attempt],
          currentChannel: 'WHATSAPP',
        };
        if (!undeliverable) {
          current = await this.persist(
            { ...current, status: delivered ? 'DELIVERED' : 'SENT' },
            correlationId,
            true,
          );
          // Riga di esito leggibile nei log dell'officina, con il codice della pratica.
          this.logger.info(`[Spoki] WhatsApp inviato per ${current.code}`, {
            jobId: current.id,
            stato: current.status,
          });
          return { job: current, outcome: { kind: 'WHATSAPP_SENT' } };
        }
        this.logger.warn('WhatsApp non consegnabile: fallback su SMS', {
          jobId: current.id,
          providerMessageId: sent.value.providerMessageId,
        });
      } else {
        current = {
          ...current,
          attempts: [
            ...current.attempts,
            this.failedAttempt(current, 'WHATSAPP', 'SPOKI', sent.error, requestedAt),
          ],
          currentChannel: 'WHATSAPP',
        };
        this.logger.warn('WhatsApp fallito: fallback su SMS', {
          jobId: current.id,
          code: sent.error.code,
          retryable: sent.error.retryable,
        });
      }
    }

    // Fallback SMS (o canale primario se il cliente non ha l'opt-in WhatsApp).
    const smsAttemptNo = current.attempts.length + 1;
    const smsRequestedAt = this.deps.clock.nowIso();
    const sms = await this.deps.smsHosting.sendSms(
      {
        idempotencyKey: `${current.idempotencyKey}:SMS:${smsAttemptNo}`,
        to: phone,
        text: current.renderedText,
        senderId: null,
        correlationId,
      },
      { correlationId },
    );

    if (sms.ok) {
      current = await this.persist(
        {
          ...current,
          status: 'SENT',
          currentChannel: 'SMS',
          attempts: [
            ...current.attempts,
            this.sentAttempt(current, 'SMS', 'SMS_HOSTING', sms.value, smsRequestedAt),
          ],
        },
        correlationId,
        true,
      );
      // `tryWhatsApp` distingue il ripiego dopo un errore dall'SMS usato come canale unico
      // (cliente senza consenso WhatsApp): nei log si legge cosa è realmente accaduto.
      this.logger.info(
        tryWhatsApp
          ? `[Spoki fallito] → [SMS] inviato per ${current.code}`
          : `[SMS] inviato per ${current.code} (cliente senza consenso WhatsApp)`,
        { jobId: current.id },
      );
      return { job: current, outcome: { kind: 'SMS_FALLBACK_SENT' } };
    }

    // Entrambi i canali hanno fallito: se l'ultimo errore è retryable (timeout, rete, rate limit)
    // il job resta FAILED per il retry automatico (M3); altrimenti serve il contatto manuale.
    const retryable = sms.error.retryable;
    current = await this.persist(
      {
        ...current,
        status: retryable ? 'FAILED' : 'MANUAL_REQUIRED',
        currentChannel: retryable ? 'SMS' : 'MANUAL',
        attempts: [
          ...current.attempts,
          this.failedAttempt(current, 'SMS', 'SMS_HOSTING', sms.error, smsRequestedAt),
        ],
      },
      correlationId,
      true,
    );
    this.logger.error(
      retryable
        ? 'entrambi i canali hanno fallito con errori temporanei: job FAILED, retry automatico o conferma manuale'
        : 'entrambi i canali hanno fallito: richiesto contatto manuale',
      {
        jobId: current.id,
        appointmentId: current.appointmentId,
        code: current.code,
        smsError: sms.error.code,
        retryable,
      },
    );
    return { job: current, outcome: { kind: retryable ? 'FAILED_RETRYABLE' : 'MANUAL_REQUIRED' } };
  }

  /** Ultima difesa contro bug inattesi: il job finisce in MANUAL_REQUIRED, mai un throw al chiamante. */
  private async failSafe(
    job: NotificationJob,
    correlationId: string,
    cause: unknown,
  ): Promise<NotificationRun> {
    this.logger.error("errore inatteso nell'orchestratore: job marcato MANUAL_REQUIRED", {
      jobId: job.id,
      cause,
    });
    const fallback: NotificationJob = {
      ...job,
      status: 'MANUAL_REQUIRED',
      currentChannel: 'MANUAL',
      updatedAt: this.deps.clock.nowIso(),
    };
    try {
      // `updateJob` ha semantica upsert: il job potrebbe non essere mai stato inserito.
      const saved = await this.persist(fallback, correlationId, true);
      return { job: saved, outcome: { kind: 'MANUAL_REQUIRED' } };
    } catch {
      return { job: fallback, outcome: { kind: 'MANUAL_REQUIRED' } };
    }
  }

  /** Salva il job aggiornando `updatedAt`; se richiesto pubblica NOTIFICATION_JOB_CHANGED. */
  private async persist(
    job: NotificationJob,
    correlationId: string,
    publish: boolean,
    actor: { kind: 'OPERATOR' | 'SYSTEM'; id: string | null } = { kind: 'SYSTEM', id: null },
  ): Promise<NotificationJob> {
    const saved = await this.deps.notifications.updateJob({
      ...job,
      updatedAt: this.deps.clock.nowIso(),
    });
    if (publish) {
      this.deps.eventBus.publish({
        id: this.deps.ids.next(),
        occurredAt: this.deps.clock.nowIso(),
        correlationId,
        actor,
        type: 'NOTIFICATION_JOB_CHANGED',
        jobId: saved.id,
        status: saved.status,
      });
    }
    return saved;
  }

  private buildAttempt(job: NotificationJob, input: AttemptInput): NotificationAttempt {
    const respondedAt = this.deps.clock.nowIso();
    return {
      id: this.deps.ids.nextAs(asNotificationAttemptId),
      jobId: job.id,
      attemptNo: job.attempts.length + 1,
      channel: input.channel,
      provider: input.provider,
      providerMessageId: input.providerMessageId,
      outcome: input.outcome,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      retryable: input.retryable,
      latencyMs: Math.max(
        0,
        new Date(respondedAt).getTime() - new Date(input.requestedAt).getTime(),
      ),
      requestedAt: input.requestedAt,
      respondedAt,
    };
  }

  private sentAttempt(
    job: NotificationJob,
    channel: NotificationChannel,
    provider: NotificationProvider,
    receipt: SendReceipt,
    requestedAt: IsoDateTime,
  ): NotificationAttempt {
    return this.buildAttempt(job, {
      channel,
      provider,
      providerMessageId: receipt.providerMessageId,
      outcome: 'SENT',
      errorCode: null,
      errorMessage: null,
      retryable: false,
      requestedAt,
    });
  }

  private failedAttempt(
    job: NotificationJob,
    channel: NotificationChannel,
    provider: NotificationProvider,
    error: ProviderError,
    requestedAt: IsoDateTime,
  ): NotificationAttempt {
    return this.buildAttempt(job, {
      channel,
      provider,
      providerMessageId: null,
      outcome: 'FAILED',
      errorCode: error.code,
      errorMessage: error.message,
      retryable: error.retryable,
      requestedAt,
    });
  }
}
