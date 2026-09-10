// Composition root UNICO dell'applicazione. `getContainer()` costruisce una sola volta
// (memoizzando su globalThis, così l'HMR di Next.js e le Route Handler condividono la
// stessa istanza) clock, id generator, logger, event bus, repository e porte esterne.
//
// Vincolo di deploy: un solo processo Node long-running (Docker/VM/servizio Windows),
// MAI serverless o multi-istanza finché lo stato vive in memoria (ADR-002).
// Dai milestone M1+ il container esporrà anche queueService, syncService, authService
// e anomalyReporter.

import { NotificationOrchestrator } from '@/application/notifications/NotificationOrchestrator';
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
import type { AppEnv } from './env';
import { parseEnv } from './env';
import type { SeedData } from './seed';
import { buildSeedData, hasDemoCredentials } from './seed';

/** Grafo delle dipendenze dell'applicazione. */
export interface Container {
  readonly env: AppEnv;
  readonly clock: IClock;
  readonly ids: IIdGenerator;
  readonly logger: ILogger;
  readonly eventBus: IEventBus;
  readonly external: ExternalServices;
  readonly repos: Repositories;
  readonly notificationOrchestrator: NotificationOrchestrator;
}

/** Override per i test: env parziale, orologio fisso, id sequenziali, logger silenzioso, store isolato. */
export interface ContainerOverrides {
  readonly env?: Partial<AppEnv>;
  readonly clock?: IClock;
  readonly ids?: IIdGenerator;
  readonly logger?: ILogger;
  readonly store?: InMemoryStore;
}

const GLOBAL_KEY = '__accettazioneContainer';

/**
 * Guard di sicurezza (fail-fast all'avvio): le credenziali demo del seed (password `plain:`,
 * token display prevedibili) non possono convivere con `NODE_ENV=production` né con un
 * qualunque provider `real` o persistenza `prisma`.
 */
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

/**
 * Costruisce un container (funzione pura rispetto a globalThis: usata dai test).
 * Se lo store non ha ancora i dati di riferimento, li carica dal seed.
 */
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
  // Alle porte esterne si passano COPIE dei dati di riferimento, mai riferimenti vivi allo store.
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

  return { env, clock, ids, logger, eventBus, external, repos, notificationOrchestrator };
}

/** Container condiviso del processo, creato alla prima chiamata e memoizzato su globalThis. */
export function getContainer(): Container {
  const g = globalThis as unknown as Record<string, unknown>;
  const existing = g[GLOBAL_KEY];
  if (isContainer(existing)) {
    return existing;
  }
  const created = createContainer();
  g[GLOBAL_KEY] = created;
  return created;
}

/** Rimuove il container e svuota lo store globale (solo test). */
export function resetContainerForTests(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  delete g[GLOBAL_KEY];
  InMemoryStore.getGlobal().reset();
}

/** Controllo strutturale (non `instanceof`): resiste alla rivalutazione del modulo con l'HMR. */
function isContainer(v: unknown): v is Container {
  return (
    typeof v === 'object' &&
    v !== null &&
    'repos' in v &&
    'external' in v &&
    'notificationOrchestrator' in v
  );
}
