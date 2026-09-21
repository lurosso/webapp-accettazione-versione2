// Limitatore di frequenza a finestra scorrevole, in memoria nel processo (nessuna dipendenza).
// Protegge le rotte pubbliche (portale cliente) da abusi ed enumerazione di targhe.
// I contatori vivono su globalThis: sopravvivono all'HMR di sviluppo e sono condivisi dalle richieste.
// Limite: vale per il singolo processo Node (coerente con lo stato in memoria di questa fase).
//
// Tre livelli, dal più largo al più stretto:
// - GLOBALE (chiave costante): la rete di sicurezza. Non dipende da chi chiama, quindi non si
//   aggira ruotando indirizzi o intestazioni; ferma un'enumerazione di massa al costo, in quel
//   minuto, di rallentare anche i clienti veri.
// - per INDIRIZZO: solo quando l'indirizzo è affidabile, cioè dietro un reverse proxy fidato
//   (`TRUST_PROXY_HEADERS=true`). Senza, `X-Forwarded-For` lo scrive il client e un contatore
//   per indirizzo è un contatore che il client azzera a piacere: meglio non averlo che averne uno
//   finto.
// - per SOGGETTO (targa, token, utente): il più stretto, e il solo che non si può falsificare.
import { parseEnv } from '@/config/env';

/** Esito di un tentativo: consentito oppure respinto con i secondi di attesa suggeriti. */
export interface RateLimitResult {
  readonly allowed: boolean;
  /** Richieste ancora disponibili nella finestra corrente. */
  readonly remaining: number;
  /** Secondi dopo i quali riprovare (valorizzato solo quando `allowed` è false). */
  readonly retryAfterSeconds: number;
}

export interface RateLimitRule {
  /** Numero massimo di richieste nella finestra. */
  readonly limit: number;
  /** Ampiezza della finestra in millisecondi. */
  readonly windowMs: number;
}

interface Buckets {
  readonly hits: Map<string, number[]>;
  /** Finestra più ampia vista finora: la pulizia non deve cancellare contatori ancora validi. */
  maxWindowMs: number;
  /** Chiamate dall'ultima pulizia. */
  sinceSweep: number;
}

const GLOBAL_KEY = '__accettazioneRateLimit';

/**
 * Tetto alle chiavi vive. Ogni soggetto cercato è una chiave: senza un tetto, chi manda centomila
 * token casuali lascia centomila voci nel processo fino al riavvio. Oltre il tetto si puliscono le
 * finestre scadute e, se non basta, si scartano le voci più vecchie (la Map conserva l'ordine di
 * inserimento).
 */
export const MAX_RATE_LIMIT_KEYS = 20_000;
const SWEEP_EVERY = 1_000;

/** Esito "consentito" per chi non ha un contatore da applicare. */
export const RATE_LIMIT_ALLOWED: RateLimitResult = {
  allowed: true,
  remaining: Number.MAX_SAFE_INTEGER,
  retryAfterSeconds: 0,
};

function buckets(): Buckets {
  const g = globalThis as unknown as Record<string, unknown>;
  const existing = g[GLOBAL_KEY];
  if (typeof existing === 'object' && existing !== null && 'hits' in existing) {
    return existing as Buckets;
  }
  const created: Buckets = { hits: new Map(), maxWindowMs: 0, sinceSweep: 0 };
  g[GLOBAL_KEY] = created;
  return created;
}

function sweep(store: Buckets, now: number): void {
  const soglia = now - store.maxWindowMs;
  for (const [key, timestamps] of store.hits) {
    const ultimo = timestamps[timestamps.length - 1];
    if (ultimo === undefined || ultimo <= soglia) {
      store.hits.delete(key);
    }
  }
  if (store.hits.size > MAX_RATE_LIMIT_KEYS) {
    let daTogliere = store.hits.size - Math.floor(MAX_RATE_LIMIT_KEYS / 2);
    for (const key of store.hits.keys()) {
      if (daTogliere <= 0) {
        break;
      }
      store.hits.delete(key);
      daTogliere -= 1;
    }
  }
  store.sinceSweep = 0;
}

/**
 * Registra un tentativo per `key` e dice se è consentito.
 * `now` è iniettabile per i test (nessuna dipendenza dall'orologio di sistema nei test).
 */
export function hitRateLimit(key: string, rule: RateLimitRule, now = Date.now()): RateLimitResult {
  const store = buckets();
  store.maxWindowMs = Math.max(store.maxWindowMs, rule.windowMs);
  store.sinceSweep += 1;
  if (store.sinceSweep >= SWEEP_EVERY || store.hits.size > MAX_RATE_LIMIT_KEYS) {
    sweep(store, now);
  }
  const windowStart = now - rule.windowMs;
  const recent = (store.hits.get(key) ?? []).filter((t) => t > windowStart);

  if (recent.length >= rule.limit) {
    store.hits.set(key, recent);
    const oldest = recent[0] ?? now;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + rule.windowMs - now) / 1000));
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  recent.push(now);
  store.hits.set(key, recent);
  return { allowed: true, remaining: rule.limit - recent.length, retryAfterSeconds: 0 };
}

/** Il primo esito respinto, altrimenti l'ultimo (tutti consentiti). */
export function combineRateLimits(...esiti: readonly RateLimitResult[]): RateLimitResult {
  return esiti.find((e) => !e.allowed) ?? esiti[esiti.length - 1] ?? RATE_LIMIT_ALLOWED;
}

/** Quante chiavi vive ci sono (solo per i test). */
export function rateLimitKeyCountForTests(): number {
  return buckets().hits.size;
}

/** Azzera i contatori (solo per i test). */
export function resetRateLimitForTests(): void {
  const store = buckets();
  store.hits.clear();
  store.sinceSweep = 0;
}

let trustProxyCache: boolean | null = null;

/** `TRUST_PROXY_HEADERS` dall'ambiente, letto una volta sola. */
function trustProxyHeaders(): boolean {
  if (trustProxyCache === null) {
    trustProxyCache = parseEnv().trustProxyHeaders;
  }
  return trustProxyCache;
}

/** Forza (o azzera con `null`) la fiducia negli header del proxy: solo per i test. */
export function setTrustProxyHeadersForTests(value: boolean | null): void {
  trustProxyCache = value;
}

/**
 * Indirizzo del chiamante, oppure `null` quando non lo si conosce in modo affidabile.
 *
 * Dietro un reverse proxy FIDATO (`trustProxy`): `x-real-ip`, che il proxy sovrascrive, altrimenti
 * l'ULTIMO valore di `x-forwarded-for`, cioè quello aggiunto dal proxy stesso — il primo lo può
 * scrivere il client. Senza proxy fidato l'intestazione non vale nulla e si risponde `null`: il
 * chiamante salta il contatore per indirizzo e restano quello globale e quelli per soggetto.
 */
export function clientIpFrom(
  headers: Headers,
  trustProxy: boolean = trustProxyHeaders(),
): string | null {
  if (!trustProxy) {
    return null;
  }
  const real = headers.get('x-real-ip')?.trim();
  if (real !== undefined && real !== '') {
    return real;
  }
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded !== null) {
    const parti = forwarded
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p !== '');
    const ultimo = parti[parti.length - 1];
    if (ultimo !== undefined) {
      return ultimo;
    }
  }
  return null;
}

/**
 * Contatore per indirizzo del chiamante: `prefix:<ip>`. Senza un indirizzo affidabile non conta
 * nulla e risponde "consentito": non è un buco, è l'ammissione che quel contatore non esiste.
 */
export function hitPerIp(
  prefix: string,
  headers: Headers,
  rule: RateLimitRule,
  now?: number,
): RateLimitResult {
  const ip = clientIpFrom(headers);
  return ip === null ? RATE_LIMIT_ALLOWED : hitRateLimit(`${prefix}:${ip}`, rule, now);
}
