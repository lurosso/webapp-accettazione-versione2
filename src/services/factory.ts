// Factory delle porte esterne: UNICO importatore di services/mocks (e domani services/real).
// Per ogni porta legge <X>_PROVIDER con fallback su SERVICES_PROVIDER; il ramo "real"
// lancia NotImplementedError all'avvio (fail-fast), mai a metà giornata.

import type { AppEnv } from '@/config/env';
import type { Brand } from '@/domain/entities/brand';
import type { Desk } from '@/domain/entities/desk';
import { NotImplementedError } from '@/domain/errors';
import type { IClock } from './interfaces/IClock';
import type { ICrmService } from './interfaces/ICrmService';
import type { IIdGenerator } from './interfaces/IIdGenerator';
import type { IInfinityService } from './interfaces/IInfinityService';
import type { ILogger } from './interfaces/ILogger';
import type { IMediaStorage } from './interfaces/IMediaStorage';
import type { ISmsHostingService } from './interfaces/ISmsHostingService';
import type { ISpokiService } from './interfaces/ISpokiService';
import {
  CrmServiceMock,
  InfinityServiceMock,
  MediaStorageMock,
  SmsHostingServiceMock,
  SpokiServiceMock,
} from './mocks';

/** Tipo di implementazione selezionabile via env (definito in interfaces/provider-kinds). */
export type { ProviderKind } from './interfaces/provider-kinds';

/** Insieme delle porte esterne esposto dal container. */
export interface ExternalServices {
  readonly infinity: IInfinityService;
  readonly spoki: ISpokiService;
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

/** Costruisce le porte esterne in base all'ambiente. */
export function createExternalServices(env: AppEnv, deps: ExternalServiceDeps): ExternalServices {
  const infinity: IInfinityService =
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
      : notImplemented('Infinity', 'INFINITY_PROVIDER');

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
      : notImplemented('Spoki', 'SPOKI_PROVIDER');

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

  // Storage media: `memory` → MediaStorageMock; `local` → MediaStorageLocalDisk (M5); `blob` → futuro.
  const mediaStorage: IMediaStorage =
    env.mediaStorageProvider === 'memory'
      ? new MediaStorageMock({ latencyMs: env.mockMediaLatencyMs }, { logger: deps.logger })
      : notImplemented(`storage media "${env.mediaStorageProvider}"`, 'MEDIA_STORAGE_PROVIDER');

  return { infinity, spoki, smsHosting, crm, mediaStorage };
}
