// Configurazione dell'adapter Infinity reale (ODBC verso SQL Anywhere), letta dall'ambiente.
//
// Vive qui e non in `env.ts` perché può contenere credenziali (`INFINITY_ODBC_UID/PWD`, solo se il
// DSN non le memorizza): l'`AppEnv` viaggia in log e diagnostica, questa configurazione no.
// Variabili: INFINITY_ODBC_DSN (obbligatoria con INFINITY_PROVIDER=real), INFINITY_DB_TYPE
// (default sql_anywhere_12), INFINITY_ODBC_UID, INFINITY_ODBC_PWD, INFINITY_DB_SCHEMA (default DBA),
// INFINITY_BOOKING_DOC_TYPES (default PR01, separati da virgola), INFINITY_PLANNING_SOURCE
// (auto | procedure | tables), INFINITY_SEDE (codice sede per la procedura), INFINITY_INCLUDE_WORK_ORDERS,
// INFINITY_ODBC_LOGIN_TIMEOUT_SEC, INFINITY_ODBC_QUERY_TIMEOUT_SEC.
import { ConfigurationError } from '@/domain/errors';
import type { EnvSource } from './env';
import { readEnvSource } from './env';

/** Motori supportati (copia locale del tipo dell'adapter: config non importa infrastructure). */
export type InfinityDbType = 'sql_anywhere_12';

/** Sorgente del planning (copia locale: `auto` prova la procedura nativa e ripiega sulle tabelle). */
export type InfinityPlanningSource = 'auto' | 'procedure' | 'tables';

const DB_TYPES: readonly InfinityDbType[] = ['sql_anywhere_12'];
const PLANNING_SOURCES: readonly InfinityPlanningSource[] = ['auto', 'procedure', 'tables'];

export interface InfinityRealConfig {
  readonly dsn: string;
  readonly dbType: InfinityDbType;
  readonly uid: string | null;
  readonly pwd: string | null;
  /** Attributi ODBC aggiuntivi (`INFINITY_ODBC_EXTRA`, es. `Host=10.10.193.18:2638`). */
  readonly extra: string | null;
  readonly schema: string;
  readonly bookingDocTypes: readonly string[];
  readonly planningSource: InfinityPlanningSource;
  readonly sede: string | null;
  readonly includeWorkOrders: boolean;
  readonly timeZone: string;
  readonly loginTimeoutSec: number;
  readonly queryTimeoutSec: number;
}

function enumValue<T extends string>(
  source: EnvSource,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const raw = trimmed(source, key);
  if (raw === null) {
    return fallback;
  }
  const found = allowed.find((v) => v === raw);
  if (found === undefined) {
    throw new ConfigurationError(`${key}="${raw}" non valido; ammessi: ${allowed.join(', ')}.`);
  }
  return found;
}

function boolValue(source: EnvSource, key: string, fallback: boolean): boolean {
  const raw = trimmed(source, key)?.toLowerCase() ?? null;
  if (raw === null) {
    return fallback;
  }
  if (raw === 'true' || raw === '1' || raw === 'yes') {
    return true;
  }
  if (raw === 'false' || raw === '0' || raw === 'no') {
    return false;
  }
  throw new ConfigurationError(`${key}="${raw}" non è un booleano (true/false).`);
}

function trimmed(source: EnvSource, key: string): string | null {
  const raw = source[key];
  return raw === undefined || raw.trim() === '' ? null : raw.trim();
}

function positiveInt(source: EnvSource, key: string, fallback: number): number {
  const raw = trimmed(source, key);
  if (raw === null) {
    return fallback;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new ConfigurationError(`${key}="${raw}" non è un intero positivo (secondi).`);
  }
  return n;
}

/**
 * Risolve la configurazione dell'adapter reale. Fail-fast: con `INFINITY_PROVIDER=real` un DSN
 * mancante o un motore sconosciuto devono fermare l'avvio, non la sync delle 06:00.
 */
export function resolveInfinityRealConfig(
  timeZone: string,
  source: EnvSource = readEnvSource(),
): InfinityRealConfig {
  const dsn = trimmed(source, 'INFINITY_ODBC_DSN');
  if (dsn === null) {
    throw new ConfigurationError(
      'INFINITY_ODBC_DSN mancante: con INFINITY_PROVIDER=real serve il nome del DSN ODBC di sistema ' +
        '(es. Infinity02 per la prova, Infinity01 per la produzione).',
    );
  }
  const dbTypeRaw = trimmed(source, 'INFINITY_DB_TYPE') ?? 'sql_anywhere_12';
  const dbType = DB_TYPES.find((t) => t === dbTypeRaw);
  if (dbType === undefined) {
    throw new ConfigurationError(
      `INFINITY_DB_TYPE="${dbTypeRaw}" non supportato; ammessi: ${DB_TYPES.join(', ')}.`,
    );
  }
  const docTypes = (trimmed(source, 'INFINITY_BOOKING_DOC_TYPES') ?? 'PR01')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  if (docTypes.length === 0) {
    throw new ConfigurationError('INFINITY_BOOKING_DOC_TYPES non può essere vuoto (default PR01).');
  }
  const schema = trimmed(source, 'INFINITY_DB_SCHEMA') ?? 'DBA';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new ConfigurationError(
      `INFINITY_DB_SCHEMA="${schema}" non è un identificatore SQL valido.`,
    );
  }
  const sede = trimmed(source, 'INFINITY_SEDE');
  if (sede !== null && !/^[A-Za-z0-9]{1,2}$/.test(sede)) {
    throw new ConfigurationError(
      `INFINITY_SEDE="${sede}" non valido: codice sede di due caratteri (tipi_doc.sede_cont, es. 01).`,
    );
  }
  return {
    dsn,
    dbType,
    uid: trimmed(source, 'INFINITY_ODBC_UID'),
    pwd: trimmed(source, 'INFINITY_ODBC_PWD'),
    extra: trimmed(source, 'INFINITY_ODBC_EXTRA'),
    schema,
    bookingDocTypes: docTypes,
    planningSource: enumValue(source, 'INFINITY_PLANNING_SOURCE', PLANNING_SOURCES, 'auto'),
    sede,
    includeWorkOrders: boolValue(source, 'INFINITY_INCLUDE_WORK_ORDERS', false),
    timeZone,
    loginTimeoutSec: positiveInt(source, 'INFINITY_ODBC_LOGIN_TIMEOUT_SEC', 10),
    queryTimeoutSec: positiveInt(source, 'INFINITY_ODBC_QUERY_TIMEOUT_SEC', 60),
  };
}
