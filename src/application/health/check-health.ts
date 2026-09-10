// Caso d'uso trasversale: stato di salute delle porte esterne (Infinity, Spoki, SMS Hosting, CRM).
// Dipende SOLO dalle interfacce (`services/interfaces`) e dal dominio: funziona identico con
// i Mock di oggi e gli adapter reali di domani. Nessun `new Date()` qui: l'istante arriva da `IClock`.
// `IMediaStorage` è escluso: infrastruttura locale senza `healthCheck()` (ARCHITECTURE.md §6.6).
import { ConfigurationError, NotImplementedError } from '@/domain/errors';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import type { CallOptions, HealthStatus, ProviderName } from '@/services/interfaces/common';
import type { IClock } from '@/services/interfaces/IClock';
import type { ICrmService } from '@/services/interfaces/ICrmService';
import type { IInfinityService } from '@/services/interfaces/IInfinityService';
import type { ISmsHostingService } from '@/services/interfaces/ISmsHostingService';
import type { ISpokiService } from '@/services/interfaces/ISpokiService';
import type { ProviderKind } from '@/services/interfaces/provider-kinds';

/**
 * Tempo massimo concesso a ogni `healthCheck()`. Oltre questa soglia la porta è riportata `DOWN`
 * anche se l'adapter non rispetta `timeoutMs`/`signal`: pagina e probe non restano mai appesi.
 */
export const HEALTH_CHECK_TIMEOUT_MS = 2000;

/**
 * Le quattro porte esterne sottoposte a health check. `ExternalServices` del factory vi è
 * assegnabile strutturalmente (ha in più `mediaStorage`, che qui non serve), quindi il chiamante
 * passa direttamente `container.external` senza che questo modulo importi dal factory.
 */
export interface ExternalHealthPorts {
  readonly infinity: IInfinityService;
  readonly spoki: ISpokiService;
  readonly smsHosting: ISmsHostingService;
  readonly crm: ICrmService;
}

/** Dipendenze del caso d'uso: orologio iniettato e implementazione dichiarata per porta. */
export interface CheckHealthDeps {
  readonly clock: IClock;
  /** Implementazione selezionata dall'ambiente per ogni porta (usata quando l'adapter non risponde). */
  readonly kinds: Readonly<Record<ProviderName, ProviderKind>>;
  /** Propagato alle porte tramite `CallOptions.correlationId` (header `x-correlation-id`). */
  readonly correlationId?: string;
}

/** Stato complessivo del sistema derivato dalle singole porte. */
export type SystemHealthStatus = 'UP' | 'DEGRADED' | 'DOWN';

/** Fotografia dello stato delle porte esterne. */
export interface SystemHealth {
  readonly status: SystemHealthStatus;
  /** Istante dell'ultimo controllo (il più recente fra le porte), null se nessuna porta ha risposto. */
  readonly checkedAt: IsoDateTime | null;
  readonly providers: readonly HealthStatus[];
}

/**
 * Risposta quando il container non può essere costruito (`ConfigurationError`, `NotImplementedError`):
 * il processo è vivo ma l'applicazione non è utilizzabile. `error` resta visibile per la diagnosi.
 */
export interface SystemHealthUnavailable {
  readonly status: 'DOWN';
  readonly checkedAt: null;
  readonly providers: readonly [];
  readonly error: { readonly name: string; readonly message: string };
}

/** Sottoinsieme di `AppEnv` con le implementazioni per porta (tipizzato in modo strutturale). */
export interface ProviderKindSource {
  readonly infinityProvider: ProviderKind;
  readonly spokiProvider: ProviderKind;
  readonly smsProvider: ProviderKind;
  readonly crmProvider: ProviderKind;
}

/** Mappa esaustiva `ProviderName → ProviderKind` derivata dall'ambiente (verificata dal compilatore). */
export function providerKindsFromEnv(env: ProviderKindSource): Record<ProviderName, ProviderKind> {
  return {
    INFINITY: env.infinityProvider,
    SPOKI: env.spokiProvider,
    SMS_HOSTING: env.smsProvider,
    CRM: env.crmProvider,
  };
}

/**
 * Riconosce le eccezioni di fail-fast del composition root (configurazione rifiutata o adapter
 * reale non disponibile). Sono le uniche che pagina e endpoint di health traducono in una
 * risposta leggibile invece di lasciarle propagare come errore 500 generico.
 */
export function isStartupError(error: unknown): error is ConfigurationError | NotImplementedError {
  return error instanceof ConfigurationError || error instanceof NotImplementedError;
}

/** Costruisce la risposta `DOWN` per un errore di avvio del container. */
export function unavailableHealth(
  error: ConfigurationError | NotImplementedError,
): SystemHealthUnavailable {
  return {
    status: 'DOWN',
    checkedAt: null,
    providers: [],
    error: { name: error.name, message: error.message },
  };
}

/** Riduce gli stati delle porte a uno stato complessivo. */
export function aggregateHealth(providers: readonly HealthStatus[]): SystemHealthStatus {
  if (providers.some((p) => p.status === 'DOWN')) return 'DOWN';
  if (providers.some((p) => p.status !== 'UP')) return 'DEGRADED';
  return 'UP';
}

/** Esito `DOWN` sintetico per una porta che ha lanciato o non ha risposto in tempo. */
function downStatus(provider: ProviderName, detail: string, deps: CheckHealthDeps): HealthStatus {
  return {
    provider,
    status: 'DOWN',
    checkedAt: deps.clock.nowIso(),
    latencyMs: null,
    detail,
    implementation: deps.kinds[provider],
  };
}

/**
 * Esegue `healthCheck()` di una porta con un limite di tempo locale: se l'adapter non risponde
 * entro `HEALTH_CHECK_TIMEOUT_MS` la promessa si risolve comunque con `DOWN`.
 * Il timer viene sempre cancellato per non tenere vivo il processo inutilmente.
 */
async function checkPort(
  port: IInfinityService | ISpokiService | ISmsHostingService | ICrmService,
  deps: CheckHealthDeps,
): Promise<HealthStatus> {
  const options: CallOptions =
    deps.correlationId === undefined
      ? { timeoutMs: HEALTH_CHECK_TIMEOUT_MS, signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS) }
      : {
          timeoutMs: HEALTH_CHECK_TIMEOUT_MS,
          signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
          correlationId: deps.correlationId,
        };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<HealthStatus>((resolve) => {
    timer = setTimeout(
      () => resolve(downStatus(port.name, `healthCheck oltre ${HEALTH_CHECK_TIMEOUT_MS} ms`, deps)),
      HEALTH_CHECK_TIMEOUT_MS,
    );
  });

  try {
    return await Promise.race([port.healthCheck(options), timeout]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Errore inatteso durante healthCheck';
    return downStatus(port.name, detail, deps);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Interroga in parallelo l'healthCheck delle quattro porte esterne.
 * Non lancia mai e non resta mai appeso: un controllo che fallisce o non risponde in tempo
 * viene riportato come `DOWN` (regola di resilienza: l'officina non deve mai bloccarsi).
 */
export async function checkExternalHealth(
  ports: ExternalHealthPorts,
  deps: CheckHealthDeps,
): Promise<SystemHealth> {
  const providers = await Promise.all(
    [ports.infinity, ports.spoki, ports.smsHosting, ports.crm].map((port) => checkPort(port, deps)),
  );
  // `IsoDateTime` è una stringa ISO UTC a larghezza fissa: l'ordinamento lessicografico è cronologico.
  const checkedAt =
    providers
      .map((p) => p.checkedAt)
      .sort()
      .at(-1) ?? null;
  return { status: aggregateHealth(providers), checkedAt, providers };
}
