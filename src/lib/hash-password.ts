// Hash e verifica delle password degli operatori con scrypt (node:crypto), solo lato server.
// Formato memorizzato: `scrypt$N=<n>,r=<r>,p=<p>$<salt base64>$<hash base64>`.
// Il prefisso `plain:` del seed demo è accettato SOLO perché il container rifiuta le credenziali
// demo appena un provider è reale o NODE_ENV=production (config/container.ts).
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SCRYPT_PREFIX = 'scrypt';
const PLAIN_PREFIX = 'plain:';
const KEY_LENGTH = 64;
const DEFAULT_PARAMS = { N: 16384, r: 8, p: 1 } as const;

interface ScryptParams {
  readonly N: number;
  readonly r: number;
  readonly p: number;
}

function parseParams(raw: string): ScryptParams | null {
  const params: Record<string, number> = {};
  for (const part of raw.split(',')) {
    const [key, value] = part.split('=');
    if (key === undefined || value === undefined) {
      return null;
    }
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n) || n <= 0) {
      return null;
    }
    params[key] = n;
  }
  const { N, r, p } = params;
  if (N === undefined || r === undefined || p === undefined) {
    return null;
  }
  return { N, r, p };
}

/** Genera l'hash scrypt di una password con sale casuale. */
export function hashPassword(plain: string, params: ScryptParams = DEFAULT_PARAMS): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, KEY_LENGTH, params);
  return `${SCRYPT_PREFIX}$N=${params.N},r=${params.r},p=${params.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/**
 * Verifica una password contro l'hash memorizzato. Confronto a tempo costante.
 * Restituisce false (mai eccezione) su formati sconosciuti o corrotti.
 */
export function verifyPassword(plain: string, stored: string): boolean {
  if (stored.startsWith(PLAIN_PREFIX)) {
    return constantTimeEquals(
      Buffer.from(plain, 'utf8'),
      Buffer.from(stored.slice(PLAIN_PREFIX.length), 'utf8'),
    );
  }
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== SCRYPT_PREFIX) {
    return false;
  }
  const params = parseParams(parts[1] ?? '');
  if (params === null) {
    return false;
  }
  try {
    const salt = Buffer.from(parts[2] ?? '', 'base64');
    const expected = Buffer.from(parts[3] ?? '', 'base64');
    const actual = scryptSync(plain, salt, expected.length, params);
    return constantTimeEquals(actual, expected);
  } catch {
    return false;
  }
}

/** True se l'hash memorizzato è una credenziale demo in chiaro (solo sviluppo). */
export function isDemoPasswordHash(stored: string): boolean {
  return stored.startsWith(PLAIN_PREFIX);
}

function constantTimeEquals(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    // Confronta comunque qualcosa di pari lunghezza per non rivelare la differenza tramite i tempi.
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}
