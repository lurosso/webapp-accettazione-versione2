// Configurazione della sessione operatore: nome del cookie, durata e segreto HS256.
// Il segreto NON passa dall'AppEnv (che è serializzabile e loggato): viene risolto qui, con la
// regola di fail-fast di TASKS.md M1-T07-S02d.
import { ConfigurationError } from '@/domain/errors';
import type { AppEnv } from './env';
import { readEnvSource, type EnvSource } from './env';

/** Nome del cookie HttpOnly che trasporta il JWT di sessione. */
export const SESSION_COOKIE_NAME = 'accettazione_session';

/** Durata della sessione in ore (turno di lavoro). */
export const SESSION_TTL_HOURS = 8;

/** Lunghezza minima del segreto in caratteri. */
export const SESSION_SECRET_MIN_LENGTH = 32;

/**
 * Segreto di sviluppo, accettato SOLO con tutti i provider mock e NODE_ENV != production.
 * È pubblico per definizione: qualunque deploy reale deve impostare SESSION_SECRET.
 */
export const DEV_SESSION_SECRET = 'sviluppo-locale-solo-mock-cambiami-in-produzione-0000';

/** Sottoinsieme di AppEnv necessario per decidere se la configurazione è "tutta mock". */
export type SessionSecretEnv = Pick<
  AppEnv,
  | 'nodeEnv'
  | 'servicesProvider'
  | 'infinityProvider'
  | 'spokiProvider'
  | 'smsProvider'
  | 'crmProvider'
  | 'repositoryProvider'
>;

/** True quando nessun sistema reale è coinvolto: solo allora il segreto di default è tollerato. */
export function isAllMock(env: SessionSecretEnv): boolean {
  return (
    env.nodeEnv !== 'production' &&
    env.servicesProvider === 'mock' &&
    env.infinityProvider === 'mock' &&
    env.spokiProvider === 'mock' &&
    env.smsProvider === 'mock' &&
    env.crmProvider === 'mock' &&
    env.repositoryProvider === 'memory'
  );
}

/**
 * Risolve il segreto di sessione da `SESSION_SECRET`.
 * - assente o vuoto: in configurazione tutta-mock usa `DEV_SESSION_SECRET`, altrimenti errore;
 * - più corto di 32 caratteri, o uguale al default fuori dalla modalità mock: errore.
 * Gli errori sono `ConfigurationError`: il processo deve fallire all'avvio, non alla prima login.
 */
export function resolveSessionSecret(
  env: SessionSecretEnv,
  source: EnvSource = readEnvSource(),
): string {
  const raw = source['SESSION_SECRET']?.trim() ?? '';
  const allMock = isAllMock(env);

  if (raw === '') {
    if (allMock) {
      return DEV_SESSION_SECRET;
    }
    throw new ConfigurationError(
      'SESSION_SECRET mancante: obbligatorio quando NODE_ENV=production o un provider non è mock. ' +
        `Impostare una stringa casuale di almeno ${SESSION_SECRET_MIN_LENGTH} caratteri.`,
    );
  }
  if (raw.length < SESSION_SECRET_MIN_LENGTH) {
    throw new ConfigurationError(
      `SESSION_SECRET troppo corto (${raw.length} caratteri): minimo ${SESSION_SECRET_MIN_LENGTH}.`,
    );
  }
  if (raw === DEV_SESSION_SECRET && !allMock) {
    throw new ConfigurationError(
      'SESSION_SECRET coincide con il valore di sviluppo: non ammesso fuori dalla modalità mock.',
    );
  }
  return raw;
}
