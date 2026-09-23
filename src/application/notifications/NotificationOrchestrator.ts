// Orchestratore delle notifiche: WhatsApp (Spoki) → SMS (SMS Hosting) → FAILED/MANUAL_REQUIRED.
// Logica REALE, mai mockata: dipende solo da interfacce. Idempotente per idempotencyKey,
// registra un NotificationAttempt per ogni chiamata, pubblica NOTIFICATION_JOB_CHANGED
// e non lancia mai eccezioni.

import {
  NOTIFICATION_DRAIN_BATCH,
  NOTIFICATION_IN_FLIGHT_STALE_MS,
  NOTIFICATION_MAX_AUTO_RETRIES,
  NOTIFICATION_RETRY_BACKOFF_MINUTES,
} from '@/config/constants';
import type { Appointment } from '@/domain/entities/appointment';
import type { Brand } from '@/domain/entities/brand';
import type {
  ManualContactOutcome,
  NotificationAttempt,
  NotificationChannel,
  NotificationJob,
  NotificationKind,
  NotificationProvider,
} from '@/domain/entities/notification';
import { buildNotificationIdempotencyKey } from '@/domain/entities/notification';
import type { DomainError } from '@/domain/errors';
import { domainError } from '@/domain/errors';
import type { AppointmentId, NotificationJobId, OperatorId } from '@/domain/ids';
import { asNotificationAttemptId, asNotificationJobId } from '@/domain/ids';
import type { Result } from '@/domain/result';
import { err, ok } from '@/domain/result';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import type { PhoneE164 } from '@/domain/value-objects/phone';
import type { INotificationRepository } from '@/repositories/interfaces/INotificationRepository';
import type { DeliveryStatus, ProviderError, SendReceipt } from '@/services/interfaces/common';
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

/**
 * Chi vuole sapere, a ogni salvataggio di un job WhatsApp, com'è andato il messaggio: oggi lo
 * specchio sulla pratica (`Appointment.whatsapp`), che coda e archivio leggono senza aprire il
 * registro delle notifiche.
 */
export interface WhatsAppDeliverySink {
  recordFromJob(job: NotificationJob): Promise<void>;
}

/** Esito di consegna riferito da Spoki (webhook), da applicare a un job già inviato. */
export interface DeliveryUpdate {
  readonly providerMessageId: string;
  readonly state: DeliveryStatus['state'];
  readonly reason: string | null;
  readonly at: IsoDateTime;
}

/** Ordine degli stati WhatsApp: un esito non porta mai un messaggio indietro (letto → consegnato). */
const WHATSAPP_RANK: Readonly<Partial<Record<NotificationJob['status'], number>>> = {
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
};

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
  /** Indirizzo pubblico del portale per i link nei messaggi (env PUBLIC_BASE_URL). */
  readonly publicBaseUrl?: string;
  /** Token di accesso al portale per pratica, aggiunto al link (`&t=`); assente nei test. */
  readonly portalToken?: (appointmentId: AppointmentId) => string;
  /** Dopo quanti ms un job IN_FLIGHT è considerato orfano e riprocessabile (default 5 minuti). */
  readonly inFlightStaleMs?: number;
  /**
   * SPOKI_OVERRIDE_CONSENT: i promemoria sono comunicazioni di servizio (utility) sull'appuntamento
   * già preso, quindi si tenta WhatsApp anche senza il consenso esplicito in anagrafica, che in
   * Infinity non esiste come opt-in WhatsApp. Default false: senza consenso si va diretti all'SMS.
   * Il ripiego SMS dopo un errore WhatsApp resta identico.
   */
  readonly whatsappConsentOverride?: boolean;
  /** Specchio dello stato WhatsApp sulla pratica; assente nei test che non lo guardano. */
  readonly whatsappDelivery?: WhatsAppDeliverySink;
  /** Minuti di anticipo ammessi per «Sono arrivato» (SPOKI_MAX_EARLY_ARRIVAL_MINUTES): finisce nel testo. */
  readonly maxEarlyArrivalMinutes?: number;
  /**
   * C'è qualcuno che ritenta davvero (`NOTIFICATION_RETRY_ENABLED` e messaggistica attiva)? Se no,
   * un fallimento temporaneo non promette un «nuovo tentativo alle…» che non arriverebbe mai: va
   * subito fra i «da contattare a mano». Default true.
   */
  readonly autoRetry?: boolean;
}

/** Input dell'invio di un promemoria. */
export interface SendReminderInput {
  readonly appointment: Appointment;
  readonly brand: Brand;
  readonly kind: NotificationKind;
  readonly correlationId: string;
  /**
   * Suffisso della chiave di idempotenza: di norma un messaggio per (pratica, tipo, giornata);
   * con il suffisso se ne ammette uno per suffisso (es. la risposta «troppo presto», che deve
   * tornare a ogni tocco, ma una volta sola per minuto).
   */
  readonly dedupeSuffix?: string;
}

/** Job + esito. */
export interface NotificationRun {
  readonly job: NotificationJob;
  readonly outcome: NotificationOutcome;
}

/** Riepilogo di una passata del temporizzatore delle riprove. */
export interface NotificationRetrySummary {
  readonly attempted: number;
  readonly sent: number;
  readonly rescheduled: number;
  readonly manualRequired: number;
  readonly skipped: number;
}

/** Chi agisce su un job dalla schermata Comunicazioni. */
export interface CommunicationActor {
  readonly operatorId: OperatorId;
  readonly displayName: string;
  /** Amministratori e responsabili possono rilasciare la presa in carico di un collega. */
  readonly privileged: boolean;
}

/** Stati in cui un job è «da gestire» a mano: c'è ancora un cliente che non sa. */
const DA_GESTIRE: readonly NotificationJob['status'][] = [
  'FAILED',
  'MANUAL_REQUIRED',
  'NO_RECIPIENT',
];

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
    const chiaveBase = buildNotificationIdempotencyKey(
      appointment.id,
      kind,
      appointment.businessDate,
    );
    const idempotencyKey =
      input.dedupeSuffix === undefined || input.dedupeSuffix === ''
        ? chiaveBase
        : `${chiaveBase}:${input.dedupeSuffix}`;
    const vars = buildTemplateVars(
      appointment,
      brand,
      this.deps.timeZone,
      this.deps.publicBaseUrl ?? '',
      this.deps.portalToken?.(appointment.id) ?? null,
      this.deps.maxEarlyArrivalMinutes,
    );
    const renderedText = NOTIFICATION_TEMPLATES[kind].render(vars);
    const now = this.deps.clock.nowIso();
    const draft: NotificationJob = {
      id: this.deps.ids.nextAs(asNotificationJobId),
      appointmentId: appointment.id,
      businessDate: appointment.businessDate,
      kind,
      idempotencyKey,
      recipientPhone: appointment.customer.phone,
      // Canale di partenza: WhatsApp con il consenso in anagrafica oppure con l'override di servizio.
      whatsappOptIn:
        appointment.customer.whatsappOptIn || this.deps.whatsappConsentOverride === true,
      code: appointment.code,
      templateVariables: { ...vars },
      renderedText,
      status: 'PENDING',
      currentChannel: null,
      attempts: [],
      manualConfirmedBy: null,
      manualNote: null,
      manualOutcome: null,
      manualConfirmedAt: null,
      nextAttemptAt: null,
      autoRetryCount: 0,
      claimedByOperatorId: null,
      claimedByName: null,
      claimedAt: null,
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
   * Stesso messaggio `kind` per un elenco di pratiche (i promemoria del giorno prima e del giorno
   * stesso, lanciati dallo scheduler o dal cron).
   *
   * Gli invii sono in sequenza, non in parallelo: un provider reale limita la frequenza e
   * l'officina non ha fretta di svuotare la coda dei messaggi. Un errore su una pratica non
   * interrompe le altre: ogni esito è registrato sul proprio job e confermabile a mano.
   */
  async sendReminders(input: {
    readonly appointments: readonly Appointment[];
    readonly brands: readonly Brand[];
    readonly kind: NotificationKind;
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
          kind: input.kind,
          correlationId: input.correlationId,
        }),
      );
    }

    const conteggio = (kind: NotificationOutcome['kind']): number =>
      runs.filter((r) => r.outcome.kind === kind).length;
    this.logger.info(
      `${input.kind}: ${runs.length} pratiche elaborate ` +
        `(WhatsApp ${conteggio('WHATSAPP_SENT')}, SMS di ripiego ${conteggio('SMS_FALLBACK_SENT')}, ` +
        `da ritentare ${conteggio('FAILED_RETRYABLE')}, da contattare a mano ${conteggio('MANUAL_REQUIRED')}, ` +
        `senza recapito ${conteggio('NO_RECIPIENT')}, già inviate ${conteggio('ALREADY_PROCESSED')})`,
    );
    return runs;
  }

  /**
   * Chi ha contattato il cliente a mano chiude la segnalazione con l'esito (telefonato, informato
   * allo sportello, non raggiungibile…) e una nota. Da qui il job non si ritenta più.
   */
  async confirmManual(
    jobId: NotificationJobId,
    operatorId: OperatorId,
    note: string,
    options: { readonly outcome?: ManualContactOutcome; readonly operatorName?: string } = {},
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
          manualOutcome: options.outcome ?? 'OTHER',
          manualConfirmedAt: this.deps.clock.nowIso(),
          nextAttemptAt: null,
          // Chi chiude ha in carico il contatto, anche se non l'aveva preso prima.
          claimedByOperatorId: job.claimedByOperatorId ?? operatorId,
          claimedByName: job.claimedByName ?? options.operatorName ?? null,
          claimedAt: job.claimedAt ?? this.deps.clock.nowIso(),
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
      const run = await this.process(
        { ...job, nextAttemptAt: null },
        job.recipientPhone,
        this.shouldTryWhatsApp(job),
        `retry:${jobId}`,
      );
      return ok(run);
    } catch (cause) {
      if (job === null) {
        return err(domainError('INTERNAL', 'Retry non riuscito.', { jobId }));
      }
      return ok(await this.failSafe(job, `retry:${jobId}`, cause));
    }
  }

  /**
   * Applica al job l'esito che Spoki riferisce con il webhook: inviato, consegnato, letto o
   * fallito. Vale solo per i job il cui canale corrente è WhatsApp (un job già passato all'SMS
   * non cambia più per un webhook tardivo) e non porta mai indietro lo stato: un «consegnato»
   * arrivato dopo il «letto» non fa nulla. L'esito finisce sul tentativo WhatsApp con quell'id; se
   * nessuno lo porta (Spoki può rispondere all'invio senza corpo, e il nostro id è allora
   * sintetico) si lega il tentativo WhatsApp corrente — l'ultimo non fallito — all'id di Spoki,
   * così i passaggi successivi si ritrovano per id. I tentativi falliti in precedenza non si
   * toccano. Ogni cambiamento è salvato e pubblicato come NOTIFICATION_JOB_CHANGED.
   */
  async applyDeliveryStatus(
    job: NotificationJob,
    update: DeliveryUpdate,
    correlationId: string,
  ): Promise<NotificationJob> {
    if (job.currentChannel !== 'WHATSAPP') {
      return job;
    }
    const stato = this.statusForDelivery(update.state);
    if (stato === null) {
      return job;
    }
    const attualeRank = WHATSAPP_RANK[job.status] ?? 0;
    if (stato !== 'FAILED' && (WHATSAPP_RANK[stato] ?? 0) <= attualeRank) {
      return job;
    }
    if (stato === 'FAILED' && (job.status === 'FAILED' || job.status === 'MANUAL_REQUIRED')) {
      return job;
    }
    const indice = this.attemptIndexFor(job, update.providerMessageId);
    const attempts = job.attempts.map((a, i) =>
      i === indice
        ? {
            ...a,
            providerMessageId: update.providerMessageId,
            outcome:
              stato === 'FAILED'
                ? ('FAILED' as const)
                : stato === 'SENT'
                  ? a.outcome
                  : ('DELIVERED' as const),
            errorCode:
              stato === 'FAILED'
                ? update.reason === null
                  ? 'UNDELIVERABLE'
                  : 'FAILED'
                : a.errorCode,
            errorMessage: stato === 'FAILED' ? update.reason : a.errorMessage,
          }
        : a,
    );
    // WhatsApp non consegnato: il ripiego SMS parte al prossimo giro del temporizzatore (la
    // riprova salta WhatsApp, che ha appena fallito). Senza riprove disponibili, contatto manuale.
    const prossimo = stato === 'FAILED' ? this.nextRetryAt(job, true) : null;
    const nuovoStato = stato === 'FAILED' && prossimo === null ? 'MANUAL_REQUIRED' : stato;
    const saved = await this.persist(
      {
        ...job,
        status: nuovoStato,
        attempts: attempts.map((a, i) =>
          i === indice && stato === 'FAILED' ? { ...a, retryable: false } : a,
        ),
        nextAttemptAt: prossimo,
      },
      correlationId,
      true,
    );
    this.logger.info(`[Spoki] esito ${update.state} per ${job.code}: job ${saved.status}`, {
      jobId: job.id,
      providerMessageId: update.providerMessageId,
    });
    return saved;
  }

  /**
   * Il tentativo a cui si riferisce un esito: quello con lo stesso id, altrimenti l'ultimo tentativo
   * WhatsApp non fallito (il messaggio in volo); -1 se non c'è nulla da legare.
   */
  private attemptIndexFor(job: NotificationJob, providerMessageId: string): number {
    const esatto = job.attempts.findIndex(
      (a) => a.channel === 'WHATSAPP' && a.providerMessageId === providerMessageId,
    );
    if (esatto >= 0) {
      return esatto;
    }
    for (let i = job.attempts.length - 1; i >= 0; i -= 1) {
      const a = job.attempts[i];
      if (a !== undefined && a.channel === 'WHATSAPP' && a.outcome !== 'FAILED') {
        return i;
      }
    }
    return -1;
  }

  /** Da stato della porta a stato del job; QUEUED non dice nulla di nuovo. */
  private statusForDelivery(state: DeliveryStatus['state']): NotificationJob['status'] | null {
    switch (state) {
      case 'SENT':
        return 'SENT';
      case 'DELIVERED':
        return 'DELIVERED';
      case 'READ':
        return 'READ';
      case 'FAILED':
      case 'UNDELIVERABLE':
        return 'FAILED';
      case 'QUEUED':
        return null;
    }
  }

  /**
   * Passata del temporizzatore: ritenta i messaggi FAILED la cui attesa è scaduta e riprende quelli
   * rimasti IN_FLIGHT per un crash. Ogni riprova conta; esaurite le riprove il job diventa
   * «da contattare a mano». I messaggi di una giornata passata non si mandano più: la loro riprova
   * si ferma e restano nella schermata Comunicazioni per chi vuole chiuderli.
   */
  async retryDue(limit = NOTIFICATION_DRAIN_BATCH): Promise<NotificationRetrySummary> {
    const now = this.deps.clock.nowIso();
    const oggi = this.deps.clock.today();
    const dovuti = await this.deps.notifications.listRetryDue(now, limit);
    const orfani = (await this.deps.notifications.listByStatus(['IN_FLIGHT'])).filter((j) =>
      this.isStaleInFlight(j),
    );
    const riepilogo = { attempted: 0, sent: 0, rescheduled: 0, manualRequired: 0, skipped: 0 };
    for (const elencato of [...dovuti, ...orfani].slice(0, Math.max(0, limit))) {
      const correlationId = this.deps.ids.next();
      // Il giro lavora su un elenco letto prima degli invii, che con i provider lenti durano: nel
      // frattempo un operatore può aver chiuso, ripreso o riprovato il messaggio. Si riparte dalla
      // copia aggiornata, e se è cambiata qualcosa il messaggio non è più di questo giro.
      const job = await this.deps.notifications.findJobById(elencato.id);
      if (job === null || job.updatedAt !== elencato.updatedAt) {
        continue;
      }
      try {
        // Un promemoria del giorno prima ha la data di domani: si ferma solo quello di un giorno
        // già passato, che al cliente non serve più.
        if (job.businessDate < oggi || job.recipientPhone === null) {
          await this.persist(
            {
              ...job,
              // Un invio rimasto a metà non resta «in viaggio» per sempre: diventa da gestire.
              status: job.status === 'IN_FLIGHT' ? 'MANUAL_REQUIRED' : job.status,
              nextAttemptAt: null,
            },
            correlationId,
            true,
          );
          riepilogo.skipped += 1;
          continue;
        }
        const contato = await this.persist(
          { ...job, autoRetryCount: job.autoRetryCount + 1, nextAttemptAt: null },
          correlationId,
          false,
        );
        const run = await this.process(
          contato,
          job.recipientPhone,
          this.shouldTryWhatsApp(job),
          correlationId,
        );
        riepilogo.attempted += 1;
        if (run.outcome.kind === 'WHATSAPP_SENT' || run.outcome.kind === 'SMS_FALLBACK_SENT') {
          riepilogo.sent += 1;
        } else if (run.outcome.kind === 'FAILED_RETRYABLE') {
          riepilogo.rescheduled += 1;
        } else if (run.outcome.kind === 'MANUAL_REQUIRED') {
          riepilogo.manualRequired += 1;
        }
      } catch (cause) {
        await this.failSafe(job, correlationId, cause);
        riepilogo.manualRequired += 1;
      }
    }
    if (riepilogo.attempted + riepilogo.skipped > 0) {
      this.logger.info('riprova dei messaggi: passata completata', { ...riepilogo });
    }
    return riepilogo;
  }

  /**
   * «Prendo io»: un operatore si prende il contatto con il cliente, così due colleghi non
   * telefonano alla stessa persona. Chi l'ha già preso può ripremere; un collega no.
   */
  async claim(
    jobId: NotificationJobId,
    actor: CommunicationActor,
  ): Promise<Result<NotificationJob, DomainError>> {
    const job = await this.deps.notifications.findJobById(jobId);
    if (job === null) {
      return err(domainError('NOT_FOUND', `Notifica non trovata: ${jobId}.`));
    }
    if (!DA_GESTIRE.includes(job.status)) {
      return err(
        domainError('INVALID_TRANSITION', 'Questa comunicazione non è più da gestire.', {
          status: job.status,
        }),
      );
    }
    if (job.claimedByOperatorId !== null && job.claimedByOperatorId !== actor.operatorId) {
      return err(
        domainError(
          'VERSION_CONFLICT',
          `La comunicazione è già in carico a ${job.claimedByName ?? 'un collega'}.`,
          { claimedBy: job.claimedByName },
        ),
      );
    }
    if (job.claimedByOperatorId === actor.operatorId) {
      return ok(job);
    }
    const salvato = await this.persist(
      {
        ...job,
        claimedByOperatorId: actor.operatorId,
        claimedByName: actor.displayName,
        claimedAt: this.deps.clock.nowIso(),
      },
      `claim:${jobId}`,
      true,
      { kind: 'OPERATOR', id: actor.operatorId },
    );
    this.logger.info(`comunicazione per ${job.code} presa in carico`, {
      jobId,
      operatorId: actor.operatorId,
    });
    return ok(salvato);
  }

  /** Lascia la presa in carico: chi l'aveva presa, oppure un responsabile o un amministratore. */
  async release(
    jobId: NotificationJobId,
    actor: CommunicationActor,
  ): Promise<Result<NotificationJob, DomainError>> {
    const job = await this.deps.notifications.findJobById(jobId);
    if (job === null) {
      return err(domainError('NOT_FOUND', `Notifica non trovata: ${jobId}.`));
    }
    if (!DA_GESTIRE.includes(job.status)) {
      return err(
        domainError('INVALID_TRANSITION', 'Questa comunicazione non è più da gestire.', {
          status: job.status,
        }),
      );
    }
    if (job.claimedByOperatorId === null) {
      return ok(job);
    }
    if (job.claimedByOperatorId !== actor.operatorId && !actor.privileged) {
      return err(
        domainError(
          'INVALID_TRANSITION',
          `La comunicazione è in carico a ${job.claimedByName ?? 'un collega'}: la rilascia lui, un responsabile o un amministratore.`,
        ),
      );
    }
    const salvato = await this.persist(
      { ...job, claimedByOperatorId: null, claimedByName: null, claimedAt: null },
      `release:${jobId}`,
      true,
      { kind: 'OPERATOR', id: actor.operatorId },
    );
    return ok(salvato);
  }

  /**
   * Si ritenta WhatsApp solo se il cliente lo consente e WhatsApp non ha già fallito in modo
   * definitivo (numero non su WhatsApp, template rifiutato, esito FAILED da Spoki): in quel caso la
   * riprova va dritta all'SMS, che è quello che serve al cliente.
   */
  private shouldTryWhatsApp(job: NotificationJob): boolean {
    if (!job.whatsappOptIn) {
      return false;
    }
    return !job.attempts.some(
      (a) => a.channel === 'WHATSAPP' && a.outcome === 'FAILED' && !a.retryable,
    );
  }

  /** Quando ritentare dopo un fallimento temporaneo; null se le riprove automatiche sono finite. */
  private nextRetryAt(job: NotificationJob, subito = false): IsoDateTime | null {
    if (this.deps.autoRetry === false || job.autoRetryCount >= NOTIFICATION_MAX_AUTO_RETRIES) {
      return null;
    }
    const minuti = subito ? 0 : (NOTIFICATION_RETRY_BACKOFF_MINUTES[job.autoRetryCount] ?? 1);
    return new Date(this.deps.clock.now().getTime() + minuti * 60_000).toISOString() as IsoDateTime;
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
            { ...current, status: delivered ? 'DELIVERED' : 'SENT', nextAttemptAt: null },
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
          nextAttemptAt: null,
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
    // Errore temporaneo con riprove ancora disponibili: FAILED con il prossimo tentativo già
    // fissato, così «sarà ritentato» è vero. Riprove finite, o errore definitivo: contatto manuale.
    const prossimo = sms.error.retryable ? this.nextRetryAt(current) : null;
    const retryable = prossimo !== null;
    current = await this.persist(
      {
        ...current,
        status: retryable ? 'FAILED' : 'MANUAL_REQUIRED',
        nextAttemptAt: prossimo,
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
        ? `entrambi i canali hanno fallito con errori temporanei: nuovo tentativo alle ${prossimo ?? '?'}`
        : sms.error.retryable
          ? 'riprove automatiche esaurite: richiesto contatto manuale'
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
      nextAttemptAt: null,
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
    // Lo specchio sulla pratica non deve mai far fallire un invio: si tenta e si registra.
    if (
      this.deps.whatsappDelivery !== undefined &&
      saved.attempts.some((a) => a.channel === 'WHATSAPP')
    ) {
      try {
        await this.deps.whatsappDelivery.recordFromJob(saved);
      } catch (cause) {
        this.logger.warn('stato WhatsApp non specchiato sulla pratica', {
          jobId: saved.id,
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }
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
