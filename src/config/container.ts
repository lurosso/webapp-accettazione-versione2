// Composition root: UNICO punto che collega porte (interfacce) e implementazioni concrete
// (oggi Mock e in-memory, domani adapter reali e Prisma) e costruisce i casi d'uso.
// Memoizzato su globalThis: sopravvive all'HMR di Next e viene condiviso da tutte le richieste.
import { LocalAuthService } from '@/application/auth/LocalAuthService';
import type { IAuthService } from '@/application/auth/IAuthService';
import { BdcLeadService } from '@/application/crm/BdcLeadService';
import { CrmNotifier } from '@/application/crm/CrmNotifier';
import { InspectionService } from '@/application/media/InspectionService';
import { NotificationOrchestrator } from '@/application/notifications/NotificationOrchestrator';
import { CodeGenerator } from '@/application/queue/CodeGenerator';
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
import { resolveSessionSecret, SESSION_TTL_HOURS } from './auth';
import type { AppEnv } from './env';
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
  readonly authService: IAuthService;
  readonly codeGenerator: CodeGenerator;
  readonly queueService: QueueService;
  readonly crmNotifier: CrmNotifier;
  readonly bdcLeadService: BdcLeadService;
  readonly inspectionService: InspectionService;
  readonly syncService: SyncService;
  readonly syncScheduler: SyncScheduler;
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
    env.spokiProvider === 'real' ||
    env.smsProvider === 'real' ||
    env.crmProvider === 'real' ||
    env.repositoryProvider === 'prisma';
  if (anyReal && hasDemoCredentials(seed)) {
    const message =
      'Configurazione rifiutata: il seed contiene credenziali demo (password "plain:" o token display prevedibili) ' +
      'ma NODE_ENV=production oppure un provider è impostato su "real"/"prisma". Sostituire il seed (M1) o tornare a mock.';
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
  const seed = buildSeedData();

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
  const external = createExternalServices(env, {
    clock,
    ids,
    logger,
    brands: [...store.state.brands],
    desks: [...store.state.desks],
  });

  const notificationOrchestrator = new NotificationOrchestrator({
    spoki: external.spoki,
    smsHosting: external.smsHosting,
    notifications: repos.notifications,
    clock,
    ids,
    logger,
    eventBus,
    timeZone: env.timeZone,
  });

  const authService = new LocalAuthService({
    operators: repos.operators,
    referenceData: repos.referenceData,
    clock,
    logger,
    secret: sessionSecret,
    ttlHours: SESSION_TTL_HOURS,
  });

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
  });

  const bdcLeadService = new BdcLeadService({
    outbox: repos.crmOutbox,
    appointments: repos.appointments,
    referenceData: repos.referenceData,
    operators: repos.operators,
    clock,
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

  const inspectionService = new InspectionService({
    appointments: repos.appointments,
    media: repos.media,
    mediaStorage: external.mediaStorage,
    queueService,
    crmNotifier,
    clock,
    ids,
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
    notifications: notificationOrchestrator,
  });

  const syncScheduler = new SyncScheduler({
    syncService,
    syncRuns: repos.syncRuns,
    clock,
    logger,
    syncHourLocal: env.syncHourLocal,
    timeZone: env.timeZone,
  });

  logger.info('[Container] inizializzato', {
    servicesProvider: env.servicesProvider,
    infinity: env.infinityProvider,
    spoki: env.spokiProvider,
    sms: env.smsProvider,
    crm: env.crmProvider,
    repository: env.repositoryProvider,
    timeZone: env.timeZone,
    nodeEnv: env.nodeEnv,
  });

  return {
    env,
    clock,
    ids,
    logger,
    eventBus,
    external,
    repos,
    notificationOrchestrator,
    authService,
    codeGenerator,
    queueService,
    crmNotifier,
    bdcLeadService,
    inspectionService,
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
    // Codice ricaricato: si sostituisce il cablaggio e si sposta il timer sul nuovo scheduler.
    existing.syncScheduler.stop();
    const rebuilt = createContainer();
    g[GLOBAL_KEY] = rebuilt;
    if (g[SCHEDULER_STARTED_KEY] === true) {
      rebuilt.syncScheduler.start();
    }
    rebuilt.logger.info('[Container] ricostruito dopo una ricompilazione (solo sviluppo)');
    return rebuilt;
  }
  const created = createContainer();
  g[GLOBAL_KEY] = created;
  return created;
}

/** Solo per i test: elimina container e stato condiviso. */
export function resetContainerForTests(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  const existing = g[GLOBAL_KEY];
  if (isContainer(existing)) {
    existing.syncScheduler.stop();
  }
  delete g[GLOBAL_KEY];
  InMemoryStore.getGlobal().reset();
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
