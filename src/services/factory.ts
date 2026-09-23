// Factory delle porte esterne: UNICO importatore di services/mocks, services/real e infrastructure.
// Per ogni porta legge <X>_PROVIDER con fallback su SERVICES_PROVIDER; i rami "real" non ancora
// disponibili lanciano NotImplementedError all'avvio (fail-fast), mai a metà giornata.

import { INFINITY_RESILIENCE } from '@/config/constants';
import type { AppEnv } from '@/config/env';
import { resolveInfinityRealConfig } from '@/config/infinity';
import type { Brand } from '@/domain/entities/brand';
import type { Desk } from '@/domain/entities/desk';
import { NotImplementedError } from '@/domain/errors';
import {
  InfinityServiceOdbc,
  SqlAnywhereOdbcClient,
  buildConnectionString,
} from '@/infrastructure/adapters/infinity';
import type { IClock } from './interfaces/IClock';
import type { ICrmService } from './interfaces/ICrmService';
import type { IIdGenerator } from './interfaces/IIdGenerator';
import type { IInfinityService } from './interfaces/IInfinityService';
import type { ILogger } from './interfaces/ILogger';
import type { IMediaStorage } from './interfaces/IMediaStorage';
import type { ISmsHostingService } from './interfaces/ISmsHostingService';
import type { ISpokiActivityLog } from './interfaces/ISpokiActivityLog';
import type { ISpokiService } from './interfaces/ISpokiService';
import { SpokiActivityLog, SpokiService } from '@/infrastructure/messaging/spoki';
import {
  CrmServiceMock,
  InfinityServiceMock,
  MediaStorageMock,
  SmsHostingServiceMock,
  SpokiServiceMock,
} from './mocks';
import { MediaStorageLocalDisk } from './real';
import { InfinityServiceResilient } from './resilience';

/** Tipo di implementazione selezionabile via env (definito in interfaces/provider-kinds). */
export type { ProviderKind } from './interfaces/provider-kinds';

/** Insieme delle porte esterne esposto dal container. */
export interface ExternalServices {
  readonly infinity: IInfinityService;
  readonly spoki: ISpokiService;
  /** Registro delle chiamate a Spoki (simulate o reali), letto dal pannello di amministrazione. */
  readonly spokiActivityLog: ISpokiActivityLog;
  readonly smsHosting: ISmsHostingService;
  readonly crm: ICrmService;
  readonly mediaStorage: IMediaStorage;
}

/** Dipendenze trasversali iniettate nelle porte (brand e sportelli come copie, mai riferimenti vivi allo store). */
export interface ExternalServiceDeps {
  readonly clock: IClock;
  readonly ids: IIdGenerator;
  readonly logger: ILogger;
  readonly brands: readonly Brand[];
  readonly desks: readonly Desk[];
}

function notImplemented(portName: string, envKey: string): never {
  throw new NotImplementedError(
    `Adapter reale ${portName} non ancora disponibile (M7). Imposta ${envKey}=mock oppure SERVICES_PROVIDER=mock.`,
  );
}

/**
 * Infinity reale: lettura del planning via ODBC (SQL Anywhere). Il DSN e il motore vengono
 * dall'ambiente (`INFINITY_ODBC_DSN`, `INFINITY_DB_TYPE`): un DSN mancante ferma l'avvio.
 */
function createInfinityOdbc(env: AppEnv, deps: ExternalServiceDeps): IInfinityService {
  const config = resolveInfinityRealConfig(env.timeZone);
  const client = new SqlAnywhereOdbcClient({
    connectionString: buildConnectionString(config),
    loginTimeoutSec: config.loginTimeoutSec,
    queryTimeoutSec: config.queryTimeoutSec,
  });
  return new InfinityServiceOdbc(config, { client, clock: deps.clock, logger: deps.logger });
}

/** Costruisce le porte esterne in base all'ambiente. */
export function createExternalServices(env: AppEnv, deps: ExternalServiceDeps): ExternalServices {
  const infinityAdapter: IInfinityService =
    env.infinityProvider === 'mock'
      ? new InfinityServiceMock(
          {
            seed: env.mockSeed,
            mode: env.mockInfinityMode,
            latencyMs: env.mockLatencyMs,
            flakyFailures: env.mockInfinityFlakyFailures,
            cancelOnSecondCall: env.mockInfinityCancelOnSecondCall,
            brands: deps.brands,
            desks: deps.desks,
            timeZone: env.timeZone,
          },
          { clock: deps.clock, logger: deps.logger },
        )
      : createInfinityOdbc(env, deps);

  // Resilienza sulla porta Infinity: timeout, ripetizione sugli errori di rete e interruttore di
  // circuito. Vale per il mock come per l'adapter reale, così il comportamento sotto guasto si
  // prova oggi e non si scopre il giorno del passaggio in produzione.
  const infinity: IInfinityService = new InfinityServiceResilient(
    infinityAdapter,
    { ...INFINITY_RESILIENCE, implementation: env.infinityProvider === 'mock' ? 'mock' : 'real' },
    { clock: deps.clock, logger: deps.logger },
  );

  // Spoki reale: modalità e blocco di sicurezza decidono se chiamare davvero o registrare soltanto.
  // Il registro è condiviso dal processo: sopravvive alla ricostruzione del container in sviluppo.
  const spokiActivityLog: ISpokiActivityLog = SpokiActivityLog.getShared(deps.ids);
  const spoki: ISpokiService =
    env.spokiProvider === 'mock'
      ? new SpokiServiceMock(
          {
            failSuffix: env.mockSpokiFailSuffix,
            failureRate: env.mockSpokiFailureRate,
            mode: env.mockSpokiMode,
            latencyMs: env.mockLatencyMs,
            deliveryDelayMs: env.mockDeliveryDelayMs,
            seed: env.mockSeed,
          },
          { clock: deps.clock, ids: deps.ids, logger: deps.logger },
        )
      : new SpokiService(
          {
            mode: env.spokiMode,
            // GUARDRAIL: con il blocco attivo nessuna chiamata HTTP parte, nemmeno in live.
            safetyLock: env.spokiSafetyLock,
            apiKey: env.spokiApiKey,
            apiBaseUrl: env.spokiApiBaseUrl,
            urls: {
              REMINDER_PREVIOUS_DAY: env.spokiUrlReminderPreviousDay,
              REMINDER_SAME_DAY: env.spokiUrlReminderSameDay,
              // Risposte ai pulsanti e messaggi del check-in: via API con l'id del template.
              ARRIVAL_CONFIRMED: null,
              LATE_CONFIRMED: null,
              ABSENT_CONFIRMED: null,
              CHECK_IN_STARTED: null,
              CHECK_IN_COMPLETED: null,
              CONFIRMATION: env.spokiUrlConfirmation,
              TURN_APPROACHING: env.spokiUrlTurnApproaching,
              CANCELLATION: env.spokiUrlCancellation,
            },
            secrets: {
              REMINDER_PREVIOUS_DAY: env.spokiSecretReminderPreviousDay,
              REMINDER_SAME_DAY: env.spokiSecretReminderSameDay,
              ARRIVAL_CONFIRMED: null,
              LATE_CONFIRMED: null,
              ABSENT_CONFIRMED: null,
              CHECK_IN_STARTED: null,
              CHECK_IN_COMPLETED: null,
              // Non integrati in questa fase: nessuna automazione, quindi nessun segreto.
              CONFIRMATION: null,
              TURN_APPROACHING: null,
              CANCELLATION: null,
            },
            templates: {
              REMINDER_PREVIOUS_DAY: env.spokiTemplateReminderD1Id,
              REMINDER_SAME_DAY: env.spokiTemplateSameDayId,
              ARRIVAL_CONFIRMED: env.spokiTemplateArrivedReplyId,
              LATE_CONFIRMED: env.spokiTemplateLateReplyId,
              ABSENT_CONFIRMED: env.spokiTemplateAbsentReplyId,
              CHECK_IN_STARTED: env.spokiTemplateWelcomeId,
              CHECK_IN_COMPLETED: env.spokiTemplateCompleteId,
              CONFIRMATION: null,
              TURN_APPROACHING: null,
              CANCELLATION: null,
            },
            timeoutMs: 8_000,
          },
          {
            clock: deps.clock,
            ids: deps.ids,
            logger: deps.logger,
            activityLog: spokiActivityLog,
            fetchImpl:
              typeof globalThis.fetch === 'function'
                ? (url, init) => globalThis.fetch(url, init)
                : undefined,
          },
        );

  const smsHosting: ISmsHostingService =
    env.smsProvider === 'mock'
      ? new SmsHostingServiceMock(
          {
            failSuffix: env.mockSmsFailSuffix,
            failureRate: env.mockSmsFailureRate,
            mode: env.mockSmsMode,
            latencyMs: env.mockLatencyMs,
            initialCredits: env.mockSmsCredits,
            seed: env.mockSeed,
          },
          { clock: deps.clock, ids: deps.ids, logger: deps.logger },
        )
      : notImplemented('SMS Hosting', 'SMS_PROVIDER');

  const crm: ICrmService =
    env.crmProvider === 'mock'
      ? new CrmServiceMock(
          { mode: env.mockCrmMode, latencyMs: env.mockLatencyMs },
          { clock: deps.clock, logger: deps.logger },
        )
      : notImplemented('CRM', 'CRM_PROVIDER');

  // Storage media: `local` → file su disco (default: le foto sopravvivono al riavvio);
  // `memory` → MediaStorageMock (test e dimostrazioni usa e getta); `blob` → cloud, futuro.
  const mediaStorage: IMediaStorage =
    env.mediaStorageProvider === 'local'
      ? new MediaStorageLocalDisk(
          { baseDir: env.mediaStorageDir },
          { ids: deps.ids, logger: deps.logger },
        )
      : env.mediaStorageProvider === 'memory'
        ? new MediaStorageMock({ latencyMs: env.mockMediaLatencyMs }, { logger: deps.logger })
        : notImplemented(`storage media "${env.mediaStorageProvider}"`, 'MEDIA_STORAGE_PROVIDER');

  return { infinity, spoki, spokiActivityLog, smsHosting, crm, mediaStorage };
}
