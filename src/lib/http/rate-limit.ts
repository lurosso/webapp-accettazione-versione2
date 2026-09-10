// Limitatore di frequenza a finestra scorrevole, in memoria nel processo (nessuna dipendenza).
// Protegge le rotte pubbliche (portale cliente) da abusi ed enumerazione di targhe.
// I contatori vivono su globalThis: sopravvivono all'HMR di sviluppo e sono condivisi dalle richieste.
// Limite: vale per il singolo processo Node (coerente con lo stato in memoria di questa fase).

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
}

const GLOBAL_KEY = '__accettazioneRateLimit';

function buckets(): Buckets {
  const g = globalThis as unknown as Record<string, unknown>;
  const existing = g[GLOBAL_KEY];
  if (typeof existing === 'object' && existing !== null && 'hits' in existing) {
    return existing as Buckets;
  }
  const created: Buckets = { hits: new Map() };
  g[GLOBAL_KEY] = created;
  return created;
}

/**
 * Registra un tentativo per `key` e dice se è consentito.
 * `now` è iniettabile per i test (nessuna dipendenza dall'orologio di sistema nei test).
 */
export function hitRateLimit(key: string, rule: RateLimitRule, now = Date.now()): RateLimitResult {
  const store = buckets().hits;
  const windowStart = now - rule.windowMs;
  const recent = (store.get(key) ?? []).filter((t) => t > windowStart);

  if (recent.length >= rule.limit) {
    store.set(key, recent);
    const oldest = recent[0] ?? now;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + rule.windowMs - now) / 1000));
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  recent.push(now);
  store.set(key, recent);
  return { allowed: true, remaining: rule.limit - recent.length, retryAfterSeconds: 0 };
}

/** Azzera i contatori (solo per i test). */
export function resetRateLimitForTests(): void {
  buckets().hits.clear();
}

/**
 * Indirizzo del chiamante dietro proxy/reverse proxy: primo valore di `x-forwarded-for`,
 * poi `x-real-ip`. Restituisce "sconosciuto" quando nessun header è presente (sviluppo locale):
 * in quel caso tutti i client condividono lo stesso contatore, comportamento accettabile in officina.
 */
export function clientIpFrom(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded !== null && forwarded.trim() !== '') {
    const first = forwarded.split(',')[0]?.trim();
    if (first !== undefined && first !== '') {
      return first;
    }
  }
  return headers.get('x-real-ip')?.trim() ?? 'sconosciuto';
}
