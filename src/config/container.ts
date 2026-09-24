// Composition root: UNICO punto che collega porte (interfacce) e implementazioni concrete
// (oggi Mock e in-memory, domani adapter reali e Prisma) e costruisce i casi d'uso.
// Memoizzato su globalThis: sopravvive all'HMR di Next e viene condiviso da tutte le richieste.
import { DevQuickLoginService } from '@/application/auth/DevQuickLoginService';
import { LocalAuthService } from '@/application/auth/LocalAuthService';
import type { IAuthService } from '@/application/auth/IAuthService';
import { BdcLeadService } from '@/application/crm/BdcLeadService';
import { CrmNotifier } from '@/application/crm/CrmNotifier';
import { CrmOutboxService } from '@/application/crm/CrmOutboxService';
import { CrmRetryScheduler } from '@/application/crm/CrmRetryScheduler';
import { AssistanceService } from '@/application/admin/AssistanceService';
import { InfinityAdvisorDirectory } from '@/application/admin/InfinityAdvisorDirectory';
import { OperatorAdminService } from '@/application/admin/OperatorAdminService';
import { InspectionArchiveService } from '@/application/media/InspectionArchiveService';
import { InspectionService } from '@/application/media/InspectionService';
import { DailyReportService } from '@/application/reporting/DailyReportService';
import { AppointmentReminderService } from '@/application/notifications/AppointmentReminderService';
import { CommunicationsService } from '@/application/notifications/CommunicationsService';
import { CustomerMessagingPolicy } from '@/application/notifications/CustomerMessagingPolicy';
import { NotificationOrchestrator } from '@/application/notifications/NotificationOrchestrator';
import { NotificationRetryScheduler } from '@/application/notifications/NotificationRetryScheduler';
import {
  AppointmentWhatsAppMirror,
  WhatsAppDeliveryService,
} from '@/application/notifications/WhatsAppDeliveryService';
import { WhatsAppInboundService } from '@/application/notifications/WhatsAppInboundService';
import { CustomerPortalService } from '@/application/portal/CustomerPortalService';
import { createPortalTokenFactory, derivePortalTokenKey } from '@/application/portal/portal-token';
import { CodeGenerator } from '@/application/queue/CodeGenerator';
import { ManualIntakeService } from '@/application/queue/ManualIntakeService';
import { SpokiDiagnosticsService } from '@/application/messaging/SpokiDiagnosticsService';
import { QueueService } from '@/application/queue/QueueService';
import { SyncScheduler } from '@/application/sync/SyncScheduler';
import { SyncService } from '@/application/sync/SyncService';
import { ConfigurationError } from '@/domain/errors';
import { createRepositories } from '@/repositories/factory';
import { InMemoryStore } from '@/repositories/in-memory/InMemoryStore';
import type { Repositories } from '@/repositories/interfaces';
import { createExternalServices } from '@/services/factory';
import type { ExternalServices } from '@/services/factory';
import type { IClock } from '@/services/interfaces/IClock';
import type { IEventBus } from '@/services/interfaces/IEventBus';
import type { IIdGenerator } from '@/services/interfaces/IIdGenerator';
import type { ILogger } from '@/services/interfaces/ILogger';
import { ConsoleLogger } from '@/services/mocks/ConsoleLogger';
import { InProcessEventBus } from '@/services/mocks/InProcessEventBus';
import { SystemClock } from '@/services/mocks/SystemClock';
import { UuidIdGenerator } from '@/services/mocks/UuidIdGenerator';
import { resolveSessionSecret, SESSION_TTL_HOURS, isAllMock } from './auth';
import type { AppEnv } from './env';
import { SystemAlertService } from '@/application/system/SystemAlertService';
import { SystemDiagnosticsService } from '@/application/system/SystemDiagnosticsService';
import { providerKindsFromEnv } from '@/application/health/check-health';
import { parseEnv } from './env';
import type { SeedData } from './seed';
import { buildSeedData, hasDemoCredentials } from './seed';

/** Tutto ciò che pagine, Route Handler e hook di avvio possono usare. */
export interface Container {
  readonly env: AppEnv;
  readonly clock: IClock;
  readonly ids: IIdGenerator;
  readonly logger: ILogger;
  readonly eventBus: IEventBus;
  readonly external: ExternalServices;
  readonly repos: Repositories;
  readonly notificationOrchestrator: NotificationOrchestrator;
  readonly spokiDiagnosticsService: SpokiDiagnosticsService;
  readonly authService: IAuthService;
  /** Accesso veloce di sviluppo (DEV_QUICK_LOGIN); null in produzione o se disattivato. */
  readonly devQuickLogin: DevQuickLoginService | null;
  readonly codeGenerator: CodeGenerator;
  readonly queueService: QueueService;
  readonly manualIntakeService: ManualIntakeService;
  readonly customerPortalService: CustomerPortalService;
  /** Risposte del cliente su WhatsApp («Arrivato», «In ritardo», «Assente»). */
  readonly whatsAppInboundService: WhatsAppInboundService;
  /** Esiti di consegna dei WhatsApp (webhook di Spoki) applicati a job e pratica. */
  readonly whatsAppDeliveryService: WhatsAppDeliveryService;
  readonly crmNotifier: CrmNotifier;
  readonly bdcLeadService: BdcLeadService;
  readonly crmOutboxService: CrmOutboxService;
  readonly crmRetryScheduler: CrmRetryScheduler;
  /** Riprova automatica dei messaggi al cliente falliti per un problema temporaneo. */
  readonly notificationRetryScheduler: NotificationRetryScheduler;
  readonly communicationsService: CommunicationsService;
  readonly inspectionService: InspectionService;
  readonly inspectionArchiveService: InspectionArchiveService;
  readonly operatorAdminService: OperatorAdminService;
  /** Matricole degli accettatori viste nel planning, per collegarle agli account. */
  readonly infinityAdvisorDirectory: InfinityAdvisorDirectory;
  readonly assistanceService: AssistanceService;
  readonly dailyReportService: DailyReportService;
  readonly messagingPolicy: CustomerMessagingPolicy;
  readonly appointmentReminderService: AppointmentReminderService;
  readonly syncService: SyncService;
  readonly syncScheduler: SyncScheduler;
  /** Segnalazioni di disfunzione dal personale all'amministratore. */
  readonly systemAlertService: SystemAlertService;
  /** Diagnostica della pagina Sistema (porte, storage, sincronizzazione). */
  readonly systemDiagnosticsService: SystemDiagnosticsService;
}

/** Sovrascritture per test e demo (clock fisso, id sequenziali, store isolato, env parziale). */
export interface ContainerOverrides {
  readonly env?: Partial<AppEnv>;
  readonly clock?: IClock;
  readonly ids?: IIdGenerator;
  readonly logger?: ILogger;
  readonly store?: InMemoryStore;
  /** Segreto di sessione esplicito (nei test evita la lettura di process.env). */
  readonly sessionSecret?: string;
}

const GLOBAL_KEY = '__accettazioneContainer';

/**
 * Flag condiviso con `instrumentation.ts`: dice se lo scheduler della sync è già stato avviato in
 * questo processo. Serve a non lasciare due timer attivi quando il container viene ricostruito.
 */
export const SCHEDULER_STARTED_KEY = '__accettazioneSchedulerStarted';

/** Rifiuta credenziali demo (password "plain:", token display prevedibili) fuori dalla modalità mock. */
function assertNoDemoCredentialsOutsideMock(env: AppEnv, seed: SeedData, logger: ILogger): void {
  const anyReal =
    env.nodeEnv === 'production' ||
    env.servicesProvider === 'real' ||
    env.infinityProvider === 'real' ||
    (env.spokiProvider === 'real' && env.spokiMode === 'live') ||
    env.smsProvider === 'real' ||
    env.crmProvider === 'real' ||
    env.repositoryProvider === 'prisma';
  if (anyReal && hasDemoCredentials(seed)) {
    const message =
      'Configurazione rifiutata: il seed contiene credenziali demo (password "plain:" o token display prevedibili) ' +
      'ma NODE_ENV=production oppure un provider è impostato su "real"/"prisma". Impostare SEED_PROFILE=real con ' +
      'SEED_ADMIN_PASSWORD_HASH e SEED_DISPLAY_TOKEN_SECRET (npm run seed:credenziali) oppure tornare a mock.';
    logger.error(`[Container] ${message}`);
    throw new ConfigurationError(message);
  }
}

export function createContainer(overrides: ContainerOverrides = {}): Container {
  const env: AppEnv = { ...parseEnv(), ...overrides.env };
  const clock = overrides.clock ?? new SystemClock(env.timeZone);
  const ids = overrides.ids ?? new UuidIdGenerator();
  const logger =
    overrides.logger ?? new ConsoleLogger('', env.nodeEnv === 'production' ? 'info' : 'debug');
  const eventBus = new InProcessEventBus();
  const store = overrides.store ?? InMemoryStore.getGlobal();
  const seed = buildSeedData(env);

  assertNoDemoCredentialsOutsideMock(env, seed, logger);
  const sessionSecret = overrides.sessionSecret ?? resolveSessionSecret(env);

  if (!store.hasReferenceData()) {
    store.seedReferenceData(seed);
    logger.info('[Container] dati di riferimento caricati dal seed', {
      brands: seed.brands.length,
      desks: seed.desks.length,
      workstations: seed.workstations.length,
      bays: seed.bays.length,
      operators: seed.operators.length,
    });
  }

  const repos = createRepositories(env, { clock, store });
  if (!env.trustProxyHeaders && env.nodeEnv === 'production') {
    logger.warn(
      '[Container] TRUST_PROXY_HEADERS=false: senza un reverse proxy fidato i contatori per indirizzo delle rotte pubbliche non si applicano (restano quelli globali e per soggetto). Dietro Nginx/Caddy/IIS impostare TRUST_PROXY_HEADERS=true.',
    );
  }
  if (!env.displayTokenRequired && !isAllMock(env)) {
    logger.warn(
      '[Container] DISPLAY_TOKEN_REQUIRED=false con dati reali: /api/v1/public/display risponde a chiunque raggiunga il server con codice e targa in lavorazione. Impostare DISPLAY_TOKEN_REQUIRED=true e passare ?token= ai monitor.',
    );
  }
  if (env.repositoryProvider === 'memory' && env.nodeEnv === 'production') {
    logger.warn(
      '[Container] REPOSITORY_PROVIDER=memory in produzione: la persistenza in memoria è DEPRECATA, pratiche, media e account spariscono al riavvio. Impostare REPOSITORY_PROVIDER=prisma e DATABASE_URL.',
    );
  }
  const external = createExternalServices(env, {
    clock,
    ids,
    logger,
    brands: [...store.state.brands],
    desks: [...store.state.desks],
  });

  // Token del portale cliente: HMAC dell'id pratica con una chiave DERIVATA dal segreto di sessione
  // (HMAC del segreto con un'etichetta fissa). I link dei messaggi e i cookie degli operatori non
  // condividono così la stessa chiave: una fuga da una parte non apre l'altra.
  const portalTokens = createPortalTokenFactory(derivePortalTokenKey(sessionSecret));

  const notificationOrchestrator = new NotificationOrchestrator({
    spoki: external.spoki,
    smsHosting: external.smsHosting,
    notifications: repos.notifications,
    clock,
    ids,
    logger,
    eventBus,
    timeZone: env.timeZone,
    publicBaseUrl: env.publicBaseUrl,
    portalToken: (appointmentId) => portalTokens.forAppointment(appointmentId),
    whatsappConsentOverride: env.spokiOverrideConsent,
    maxEarlyArrivalMinutes: env.spokiMaxEarlyArrivalMinutes,
    // Il «nuovo tentativo alle…» si promette solo se il temporizzatore della riprova gira davvero.
    autoRetry: env.notificationRetryEnabled && !env.messagingStandby,
    // Ogni job WhatsApp salvato aggiorna lo stato sulla pratica: coda e archivio lo leggono da lì.
    whatsappDelivery: new AppointmentWhatsAppMirror(repos.appointments, logger),
  });
  const whatsAppDeliveryService = new WhatsAppDeliveryService({
    appointments: repos.appointments,
    notifications: repos.notifications,
    orchestrator: notificationOrchestrator,
    clock,
    logger,
  });
  // Con lo standby attivo la riga sull'override di consenso direbbe una cosa che non succede:
  // i promemoria non partono affatto. Si stampa solo quando l'integrazione è accesa.
  if (env.spokiOverrideConsent && !env.messagingStandby) {
    logger.info(
      '[Messaggi] SPOKI_OVERRIDE_CONSENT=true: i promemoria tentano WhatsApp anche senza opt-in in anagrafica (comunicazioni di servizio); il guardrail degli invii reali resta SPOKI_MODE/SPOKI_SAFETY_LOCK.',
    );
  }

  const customerPortalService = new CustomerPortalService({
    appointments: repos.appointments,
    referenceData: repos.referenceData,
    operators: repos.operators,
    eventBus,
    clock,
    ids,
    logger,
    tokens: portalTokens,
    writesRequireToken: env.portalWritesRequireToken,
  });

  // GUARDRAIL: un WhatsApp reale può partire solo con Spoki reale, in live e con il blocco di
  // sicurezza tolto. Il blocco fisico sta nell'adapter; qui il flag serve a policy, promemoria e
  // pannello per dire chiaramente che si lavora in dry-run.
  const spokiLiveDeliveryAllowed =
    env.spokiProvider === 'real' && env.spokiMode === 'live' && !env.spokiSafetyLock;

  const spokiDiagnosticsService = new SpokiDiagnosticsService({
    spoki: external.spoki,
    activityLog: external.spokiActivityLog,
    appointments: repos.appointments,
    config: {
      provider: env.spokiProvider,
      enabled: env.spokiEnabled,
      mode: env.spokiMode,
      safetyLock: env.spokiSafetyLock,
      webhookSecretConfigured: env.spokiWebhookSecret !== null,
      webhookSecretsCount: env.spokiWebhookSecrets.length,
      repliesByAutomation: env.spokiRepliesByAutomation,
      templateIds: {
        reminderPreviousDay: env.spokiTemplateReminderD1Id,
        reminderSameDay: env.spokiTemplateSameDayId,
        arrivalConfirmed: env.spokiTemplateArrivedReplyId,
        lateConfirmed: env.spokiTemplateLateReplyId,
        absentConfirmed: env.spokiTemplateAbsentReplyId,
        arrivalTooEarly: env.spokiTemplateEarlyReplyId,
        checkInStarted: env.spokiTemplateWelcomeId,
        checkInCompleted: env.spokiTemplateCompleteId,
      },
      consentOverride: env.spokiOverrideConsent,
      allowedRecipients: env.spokiAllowedRecipients,
      publicSends: env.spokiPublicSends,
      apiKey: env.spokiApiKey,
      reminders: {
        previousDay: {
          url: env.spokiUrlReminderPreviousDay,
          secret: env.spokiSecretReminderPreviousDay,
        },
        sameDay: { url: env.spokiUrlReminderSameDay, secret: env.spokiSecretReminderSameDay },
      },
      publicBaseUrl: env.publicBaseUrl,
      reminderPreviousDayHourLocal: env.reminderPreviousDayHourLocal,
      reminderSameDayHourLocal: env.reminderSameDayHourLocal,
      remindersEnabled: env.remindersEnabled && !env.messagingStandby,
      standby: env.messagingStandby,
    },
    ids,
    clock,
    logger,
  });

  // STANDBY della messaggistica (MESSAGING_STANDBY=true): promemoria, messaggi guidati dagli
  // eventi e risposte in entrata restano nel codice ma non partono. L'officina lavora lo stesso e
  // i log non si riempiono di invii che nessuno ha chiesto: è la modalità di sviluppo mentre si
  // completa il resto dell'applicazione.
  if (env.messagingStandby) {
    logger.info(
      "[Messaggi] MESSAGING_STANDBY=true: integrazione cliente in pausa (nessun promemoria, nessun messaggio a evento, webhook delle risposte spento). Il resto dell'applicazione funziona normalmente.",
    );
  }

  // Messaggi al cliente guidati dagli eventi: ascolta il bus e manda conferme, "turno vicino" e
  // annullamenti senza che coda o sync sappiano nulla di WhatsApp.
  const messagingPolicy = new CustomerMessagingPolicy({
    eventBus,
    appointments: repos.appointments,
    referenceData: repos.referenceData,
    orchestrator: notificationOrchestrator,
    ids,
    logger,
    enabled: env.messagingTriggersEnabled && !env.messagingStandby,
    liveDeliveryAllowed: spokiLiveDeliveryAllowed,
  });
  messagingPolicy.start();

  const authService = new LocalAuthService({
    operators: repos.operators,
    referenceData: repos.referenceData,
    claims: repos.workstationClaims,
    clock,
    logger,
    secret: sessionSecret,
    ttlHours: SESSION_TTL_HOURS,
  });
  const devQuickLogin =
    env.devQuickLogin && env.nodeEnv !== 'production'
      ? new DevQuickLoginService({
          operators: repos.operators,
          referenceData: repos.referenceData,
          claims: repos.workstationClaims,
          auth: authService,
          clock,
          logger,
        })
      : null;
  if (devQuickLogin !== null) {
    logger.info(
      '[Auth] accesso veloce di sviluppo attivo (DEV_QUICK_LOGIN): pulsanti senza credenziali nella pagina di login, account dev.*',
    );
  }

  const codeGenerator = new CodeGenerator(repos.appointments, {
    sitePrefix: env.codePrefix,
    scope: env.codeSequenceScope,
  });

  const crmNotifier = new CrmNotifier({
    crm: external.crm,
    outbox: repos.crmOutbox,
    referenceData: repos.referenceData,
    clock,
    ids,
    logger,
    eventBus,
  });

  const crmOutboxService = new CrmOutboxService({
    outbox: repos.crmOutbox,
    notifier: crmNotifier,
    logger,
  });

  // Rinvii automatici verso il CRM: un temporizzatore nel processo, spegnibile da env quando i
  // rinvii li fa un cron esterno sull'endpoint dedicato.
  const crmRetryScheduler = new CrmRetryScheduler({ notifier: crmNotifier, logger });
  const notificationRetryScheduler = new NotificationRetryScheduler({
    orchestrator: notificationOrchestrator,
    logger,
  });
  const communicationsService = new CommunicationsService({
    notifications: repos.notifications,
    appointments: repos.appointments,
    operators: repos.operators,
    orchestrator: notificationOrchestrator,
    clock,
    logger,
  });

  const bdcLeadService = new BdcLeadService({
    outbox: repos.crmOutbox,
    appointments: repos.appointments,
    referenceData: repos.referenceData,
    operators: repos.operators,
    clock,
    logger,
  });

  const manualIntakeService = new ManualIntakeService({
    appointments: repos.appointments,
    referenceData: repos.referenceData,
    codeGenerator,
    eventBus,
    clock,
    ids,
    logger,
  });

  const queueService = new QueueService({
    appointments: repos.appointments,
    referenceData: repos.referenceData,
    operators: repos.operators,
    notifications: repos.notifications,
    crmNotifier,
    eventBus,
    clock,
    ids,
    logger,
  });

  // Le risposte del cliente su WhatsApp arrivano dopo la coda: usano portale e coda come farebbe
  // una persona allo sportello, senza logica propria.
  const whatsAppInboundService = new WhatsAppInboundService({
    appointments: repos.appointments,
    referenceData: repos.referenceData,
    portal: customerPortalService,
    queueService,
    orchestrator: notificationOrchestrator,
    eventBus,
    clock,
    ids,
    logger,
    maxEarlyArrivalMinutes: env.spokiMaxEarlyArrivalMinutes,
    repliesByAutomation: env.spokiRepliesByAutomation,
  });

  const inspectionService = new InspectionService({
    appointments: repos.appointments,
    media: repos.media,
    mediaStorage: external.mediaStorage,
    queueService,
    crmNotifier,
    clock,
    ids,
    logger,
    retentionDays: env.photoRetentionDays,
  });

  const inspectionArchiveService = new InspectionArchiveService({
    appointments: repos.appointments,
    media: repos.media,
    mediaStorage: external.mediaStorage,
    referenceData: repos.referenceData,
    clock,
    logger,
    hardDeleteDays: env.photoHardDeleteDays,
  });

  const operatorAdminService = new OperatorAdminService({
    operators: repos.operators,
    referenceData: repos.referenceData,
    ids,
    logger,
  });
  const infinityAdvisorDirectory = new InfinityAdvisorDirectory({
    appointments: repos.appointments,
    operators: repos.operators,
    clock,
  });

  const assistanceService = new AssistanceService({
    appointments: repos.appointments,
    referenceData: repos.referenceData,
    operators: repos.operators,
    claims: repos.workstationClaims,
    clock,
  });

  const dailyReportService = new DailyReportService({
    appointments: repos.appointments,
    referenceData: repos.referenceData,
    operators: repos.operators,
    media: repos.media,
    logger,
  });

  const syncService = new SyncService({
    infinity: external.infinity,
    appointments: repos.appointments,
    syncRuns: repos.syncRuns,
    referenceData: repos.referenceData,
    codeGenerator,
    eventBus,
    clock,
    ids,
    logger,
    timeZone: env.timeZone,
  });

  // I due promemoria ai clienti (giorno prima, giorno stesso): passano dall'orchestratore, quindi
  // dal guardrail Spoki; li lancia lo scheduler alle ore configurate o il cron esterno.
  const appointmentReminderService = new AppointmentReminderService({
    appointments: repos.appointments,
    referenceData: repos.referenceData,
    orchestrator: notificationOrchestrator,
    syncService,
    clock,
    ids,
    logger,
    enabled: env.remindersEnabled && !env.messagingStandby,
    liveDeliveryAllowed: spokiLiveDeliveryAllowed,
  });

  const syncScheduler = new SyncScheduler({
    syncService,
    syncRuns: repos.syncRuns,
    queueService,
    appointments: repos.appointments,
    archive: inspectionArchiveService,
    clock,
    logger,
    syncHourLocal: env.syncHourLocal,
    businessDayEndLocal: env.businessDayEndLocal,
    timeZone: env.timeZone,
    reminders: appointmentReminderService,
    reminderPreviousDayHourLocal: env.reminderPreviousDayHourLocal,
    reminderSameDayHourLocal: env.reminderSameDayHourLocal,
  });

  // Demo interna: detto all'avvio, così nessuno pensa di aver aperto gli invii al pubblico.
  if (env.spokiProvider === 'real' && env.spokiMode === 'live' && !env.spokiSafetyLock) {
    if (env.spokiPublicSends) {
      logger.warn(
        '[Messaggi] SPOKI_PUBLIC_SENDS=true: i WhatsApp reali partono verso TUTTI i clienti.',
      );
    } else {
      logger.warn(
        `[Messaggi] DEMO INTERNA: WhatsApp reali solo verso ${env.spokiAllowedRecipients.length} numeri di SPOKI_ALLOWED_RECIPIENTS; per tutti gli altri clienti l'invio resta simulato.`,
      );
    }
  }

  logger.info('[Container] inizializzato', {
    servicesProvider: env.servicesProvider,
    infinity: env.infinityProvider,
    spoki: env.spokiProvider,
    spokiEnabled: env.spokiEnabled,
    spokiMode: env.spokiMode,
    spokiSafetyLock: env.spokiSafetyLock,
    spokiWebhook: env.spokiWebhookSecret !== null,
    whatsappReali: spokiLiveDeliveryAllowed,
    sms: env.smsProvider,
    crm: env.crmProvider,
    repository: env.repositoryProvider,
    timeZone: env.timeZone,
    nodeEnv: env.nodeEnv,
  });

  const systemAlertService = new SystemAlertService({
    alerts: repos.systemAlerts,
    referenceData: repos.referenceData,
    eventBus,
    clock,
    ids,
    logger,
  });
  const systemDiagnosticsService = new SystemDiagnosticsService({
    external,
    kinds: providerKindsFromEnv(env),
    mediaStorage: external.mediaStorage,
    syncRuns: repos.syncRuns,
    clock,
    ids,
    logger,
    timeZone: env.timeZone,
  });

  return {
    env,
    clock,
    ids,
    logger,
    eventBus,
    external,
    repos,
    systemAlertService,
    systemDiagnosticsService,
    notificationOrchestrator,
    authService,
    devQuickLogin,
    codeGenerator,
    queueService,
    manualIntakeService,
    customerPortalService,
    whatsAppInboundService,
    whatsAppDeliveryService,
    spokiDiagnosticsService,
    crmNotifier,
    bdcLeadService,
    crmOutboxService,
    crmRetryScheduler,
    notificationRetryScheduler,
    communicationsService,
    inspectionService,
    inspectionArchiveService,
    operatorAdminService,
    infinityAdvisorDirectory,
    assistanceService,
    dailyReportService,
    messagingPolicy,
    appointmentReminderService,
    syncService,
    syncScheduler,
  };
}

/**
 * Container condiviso del processo (creato alla prima richiesta o da `instrumentation.ts`).
 *
 * In sviluppo l'HMR ricarica i moduli ma il container resta memoizzato su `globalThis`: senza
 * il controllo `instanceof` qui sotto si continuerebbe a usare il cablaggio vecchio, e un metodo
 * appena aggiunto a un caso d'uso risulterebbe inesistente a runtime (errore molto difficile da
 * leggere, perché compilazione e test sono verdi). Se le classi sono state ricaricate il container
 * viene ricostruito; lo stato della coda non si perde, perché vive nell'`InMemoryStore`, che è
 * riconosciuto per struttura e non per identità di classe.
 * In produzione l'identità delle classi è stabile, quindi la ricostruzione non avviene mai.
 */
export function getContainer(): Container {
  const g = globalThis as unknown as Record<string, unknown>;
  const existing = g[GLOBAL_KEY];
  if (isContainer(existing)) {
    if (existing.queueService instanceof QueueService) {
      return existing;
    }
    // Codice ricaricato: si sostituisce il cablaggio e si spostano i timer sui nuovi scheduler.
    existing.syncScheduler.stop();
    existing.crmRetryScheduler.stop();
    // Un container creato prima che esistesse la riprova dei messaggi non ha questo scheduler.
    (existing as Partial<Container>).notificationRetryScheduler?.stop();
    existing.messagingPolicy.stop();
    const rebuilt = createContainer();
    g[GLOBAL_KEY] = rebuilt;
    if (g[SCHEDULER_STARTED_KEY] === true) {
      rebuilt.syncScheduler.start();
      if (rebuilt.env.crmRetryEnabled) {
        rebuilt.crmRetryScheduler.start();
      }
      if (rebuilt.env.notificationRetryEnabled && !rebuilt.env.messagingStandby) {
        rebuilt.notificationRetryScheduler.start();
      }
    }
    rebuilt.logger.info('[Container] ricostruito dopo una ricompilazione (solo sviluppo)');
    return rebuilt;
  }
  const created = createContainer();
  g[GLOBAL_KEY] = created;
  return created;
}

/**
 * Solo per i test: installa un container costruito con `createContainer(overrides)` come quello
 * che `getContainer()` restituisce, così un Route Handler si prova con env e store isolati.
 */
export function setContainerForTests(container: Container): void {
  const g = globalThis as unknown as Record<string, unknown>;
  g[GLOBAL_KEY] = container;
}

/** Solo per i test: elimina container e stato condiviso. */
export function resetContainerForTests(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  const existing = g[GLOBAL_KEY];
  if (isContainer(existing)) {
    existing.syncScheduler.stop();
    existing.crmRetryScheduler.stop();
    existing.notificationRetryScheduler.stop();
    existing.messagingPolicy.stop();
  }
  delete g[GLOBAL_KEY];
  InMemoryStore.getGlobal().reset();
  if (isContainer(existing)) {
    existing.external.spokiActivityLog.clear();
  }
}

function isContainer(v: unknown): v is Container {
  // `queueService` distingue un container completo da uno creato prima di M1 (HMR).
  return (
    typeof v === 'object' &&
    v !== null &&
    'repos' in v &&
    'external' in v &&
    'queueService' in v &&
    'syncScheduler' in v
  );
}
