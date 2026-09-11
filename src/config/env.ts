// Lettura e parsing tipizzato delle variabili d'ambiente, con default sicuri (tutto mock).
// L'ambiente è letto da `process.env` (tipizzato da @types/node), con fallback su un oggetto vuoto
// dove `process` non esiste (browser, test isolati). In M0-T10 il parser manuale sarà sostituito
// da uno schema Zod che esporta gli stessi tipi.
// Non importa nulla dai factory né dai mock: i tipi condivisi vivono in services/interfaces.

import type {
  CrmMockMode,
  InfinityMockMode,
  ProviderMockMode,
} from '@/services/interfaces/mock-config';
import { MOCK_PHONE_RULES } from '@/services/interfaces/mock-config';
import type {
  MediaStorageProvider,
  ProviderKind,
  RepositoryProvider,
} from '@/services/interfaces/provider-kinds';
import { DEFAULT_CODE_PREFIX, DEFAULT_SYNC_HOUR_LOCAL, TIMEZONE } from './constants';

/** Sorgente grezza delle variabili (process.env o un oggetto nei test). */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/** Legge `process.env` se esiste (Node, edge), altrimenti un oggetto vuoto (browser, test isolati). */
export function readEnvSource(): EnvSource {
  return typeof process !== 'undefined' && process.env !== undefined ? process.env : {};
}

/** Configurazione applicativa tipizzata. */
export interface AppEnv {
  readonly servicesProvider: ProviderKind;
  readonly infinityProvider: ProviderKind;
  readonly spokiProvider: ProviderKind;
  readonly smsProvider: ProviderKind;
  readonly crmProvider: ProviderKind;
  readonly repositoryProvider: RepositoryProvider;
  readonly mediaStorageProvider: MediaStorageProvider;
  /**
   * Fuso dell'officina (`APP_TIMEZONE`, zona IANA validata). Volutamente NON letto da `TZ`:
   * nei container Docker `TZ` è spesso UTC e farebbe scivolare giornata operativa e sync.
   */
  readonly timeZone: string;
  /** Ora locale "HH:mm" della sync giornaliera. */
  readonly syncHourLocal: string;
  readonly codePrefix: string;
  readonly codeSequenceScope: 'SITE' | 'BRAND';
  readonly mockSeed: string;
  readonly mockLatencyMs: number;
  readonly mockInfinityMode: InfinityMockMode;
  readonly mockInfinityFlakyFailures: number;
  /** Se true, ~5 % dell'agenda risulta annullata dalla seconda chiamata dello stesso giorno (reconciliation). */
  readonly mockInfinityCancelOnSecondCall: boolean;
  readonly mockSpokiFailSuffix: string;
  readonly mockSpokiFailureRate: number | null;
  readonly mockSpokiMode: ProviderMockMode;
  readonly mockSmsFailSuffix: string;
  readonly mockSmsFailureRate: number | null;
  readonly mockSmsMode: ProviderMockMode;
  readonly mockSmsCredits: number;
  readonly mockCrmMode: CrmMockMode;
  readonly mockDeliveryDelayMs: number;
  readonly nodeEnv: 'development' | 'test' | 'production';
}

/** Callback per i valori non validi (default: console.warn). */
export type EnvWarning = (message: string) => void;

const PROVIDER_KINDS: readonly ProviderKind[] = ['mock', 'real'];
const REPOSITORY_PROVIDERS: readonly RepositoryProvider[] = ['memory', 'prisma'];
const MEDIA_PROVIDERS: readonly MediaStorageProvider[] = ['memory', 'local', 'blob'];
const INFINITY_MODES: readonly InfinityMockMode[] = [
  'ok',
  'error',
  'timeout',
  'flaky',
  'partial',
  'empty',
];
const UP_DOWN: readonly ProviderMockMode[] = ['ok', 'down'];
const CRM_MODES: readonly CrmMockMode[] = ['ok', 'error', 'timeout', 'flaky'];
const SEQUENCE_SCOPES: readonly AppEnv['codeSequenceScope'][] = ['SITE', 'BRAND'];
const NODE_ENVS: readonly AppEnv['nodeEnv'][] = ['development', 'test', 'production'];

function defaultWarning(message: string): void {
  console.warn(`[env] ${message}`);
}

function pickEnum<T extends string>(
  source: EnvSource,
  key: string,
  allowed: readonly T[],
  fallback: T,
  warn: EnvWarning,
): T {
  const raw = source[key];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const found = allowed.find((v) => v === raw.trim());
  if (found === undefined) {
    warn(`${key}="${raw}" non valido; ammessi: ${allowed.join(', ')}. Uso "${fallback}".`);
    return fallback;
  }
  return found;
}

function pickString(source: EnvSource, key: string, fallback: string): string {
  const raw = source[key];
  return raw === undefined || raw.trim() === '' ? fallback : raw.trim();
}

function pickBool(source: EnvSource, key: string, fallback: boolean, warn: EnvWarning): boolean {
  const raw = source[key];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') {
    return true;
  }
  if (v === 'false' || v === '0' || v === 'no') {
    return false;
  }
  warn(`${key}="${raw}" non è un booleano (true/false). Uso ${String(fallback)}.`);
  return fallback;
}

function pickInt(
  source: EnvSource,
  key: string,
  fallback: number,
  warn: EnvWarning,
  min = 0,
): number {
  const raw = source[key];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min) {
    warn(`${key}="${raw}" non è un intero ≥ ${min}. Uso ${fallback}.`);
    return fallback;
  }
  return n;
}

function pickRateOrNull(source: EnvSource, key: string, warn: EnvWarning): number | null {
  const raw = source[key];
  if (raw === undefined || raw.trim() === '') {
    return null;
  }
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    warn(`${key}="${raw}" non è un numero fra 0 e 1. Regola delle cifre attiva.`);
    return null;
  }
  return n;
}

function pickHourLocal(source: EnvSource, key: string, fallback: string, warn: EnvWarning): string {
  const raw = pickString(source, key, fallback);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) {
    warn(`${key}="${raw}" non è un orario HH:mm. Uso "${fallback}".`);
    return fallback;
  }
  return raw;
}

/**
 * Legge una zona IANA e la valida con `Intl.DateTimeFormat`: un valore errato farebbe
 * lanciare RangeError alla prima `toBusinessDate` (crash all'avvio), quindi si ricade sul default.
 */
function pickTimeZone(source: EnvSource, key: string, fallback: string, warn: EnvWarning): string {
  const raw = pickString(source, key, fallback);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: raw });
    return raw;
  } catch {
    warn(`${key}="${raw}" non è una zona IANA valida. Uso "${fallback}".`);
    return fallback;
  }
}

/**
 * Parsing dell'ambiente con default sicuri: tutto mock/memory, fuso Europe/Rome,
 * sync alle 06:00, prefisso codice "F". I valori non validi producono un warning
 * e ricadono sul default: la configurazione non deve mai impedire l'avvio.
 *
 * Variabili lette: SERVICES_PROVIDER, INFINITY_PROVIDER, SPOKI_PROVIDER, SMS_PROVIDER,
 * CRM_PROVIDER, REPOSITORY_PROVIDER, MEDIA_STORAGE_PROVIDER, APP_TIMEZONE, SYNC_HOUR_LOCAL,
 * CODE_PREFIX, CODE_SEQUENCE_SCOPE, MOCK_SEED, MOCK_LATENCY_MS,
 * MOCK_INFINITY_MODE, MOCK_INFINITY_FLAKY_FAILURES, MOCK_INFINITY_CANCEL_ON_SECOND_CALL,
 * MOCK_SPOKI_FAIL_SUFFIX, MOCK_SPOKI_FAILURE_RATE, MOCK_SPOKI_MODE, MOCK_SMS_FAIL_SUFFIX,
 * MOCK_SMS_FAILURE_RATE, MOCK_SMS_MODE, MOCK_SMS_CREDITS, MOCK_CRM_MODE, MOCK_DELIVERY_DELAY_MS, NODE_ENV.
 */
export function parseEnv(
  source: EnvSource = readEnvSource(),
  warn: EnvWarning = defaultWarning,
): AppEnv {
  const servicesProvider = pickEnum(source, 'SERVICES_PROVIDER', PROVIDER_KINDS, 'mock', warn);
  const perPort = (key: string): ProviderKind =>
    pickEnum(source, key, PROVIDER_KINDS, servicesProvider, warn);

  return {
    servicesProvider,
    infinityProvider: perPort('INFINITY_PROVIDER'),
    spokiProvider: perPort('SPOKI_PROVIDER'),
    smsProvider: perPort('SMS_PROVIDER'),
    crmProvider: perPort('CRM_PROVIDER'),
    repositoryProvider: pickEnum(
      source,
      'REPOSITORY_PROVIDER',
      REPOSITORY_PROVIDERS,
      'memory',
      warn,
    ),
    mediaStorageProvider: pickEnum(
      source,
      'MEDIA_STORAGE_PROVIDER',
      MEDIA_PROVIDERS,
      'memory',
      warn,
    ),
    timeZone: pickTimeZone(source, 'APP_TIMEZONE', TIMEZONE, warn),
    syncHourLocal: pickHourLocal(source, 'SYNC_HOUR_LOCAL', DEFAULT_SYNC_HOUR_LOCAL, warn),
    codePrefix: pickString(source, 'CODE_PREFIX', DEFAULT_CODE_PREFIX).toUpperCase(),
    codeSequenceScope: pickEnum(source, 'CODE_SEQUENCE_SCOPE', SEQUENCE_SCOPES, 'SITE', warn),
    mockSeed: pickString(source, 'MOCK_SEED', 'autoclub-demo'),
    mockLatencyMs: pickInt(source, 'MOCK_LATENCY_MS', 150, warn),
    mockInfinityMode: pickEnum(source, 'MOCK_INFINITY_MODE', INFINITY_MODES, 'ok', warn),
    mockInfinityFlakyFailures: pickInt(source, 'MOCK_INFINITY_FLAKY_FAILURES', 2, warn),
    mockInfinityCancelOnSecondCall: pickBool(
      source,
      'MOCK_INFINITY_CANCEL_ON_SECOND_CALL',
      true,
      warn,
    ),
    mockSpokiFailSuffix: pickString(
      source,
      'MOCK_SPOKI_FAIL_SUFFIX',
      MOCK_PHONE_RULES.whatsappInvalid,
    ),
    mockSpokiFailureRate: pickRateOrNull(source, 'MOCK_SPOKI_FAILURE_RATE', warn),
    mockSpokiMode: pickEnum(source, 'MOCK_SPOKI_MODE', UP_DOWN, 'ok', warn),
    mockSmsFailSuffix: pickString(
      source,
      'MOCK_SMS_FAIL_SUFFIX',
      MOCK_PHONE_RULES.bothChannelsFail,
    ),
    mockSmsFailureRate: pickRateOrNull(source, 'MOCK_SMS_FAILURE_RATE', warn),
    mockSmsMode: pickEnum(source, 'MOCK_SMS_MODE', UP_DOWN, 'ok', warn),
    mockSmsCredits: pickInt(source, 'MOCK_SMS_CREDITS', 500, warn),
    mockCrmMode: pickEnum(source, 'MOCK_CRM_MODE', CRM_MODES, 'ok', warn),
    mockDeliveryDelayMs: pickInt(source, 'MOCK_DELIVERY_DELAY_MS', 3000, warn),
    nodeEnv: pickEnum(source, 'NODE_ENV', NODE_ENVS, 'development', warn),
  };
}
