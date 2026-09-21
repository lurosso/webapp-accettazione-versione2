// GET /api/v1/health: liveness del processo + HealthStatus aggregato delle quattro porte esterne.
//
// Codici HTTP (ARCHITECTURE.md §6.6):
// - senza parametri → sempre 200 finché il processo risponde (probe di liveness per Docker/monitor:
//   una dipendenza esterna giù NON deve far riavviare l'app, che continua con i fallback manuali);
// - `?probe=dependencies` → 503 quando lo stato aggregato è `DOWN` (readiness delle dipendenze);
// - container non costruibile (`ConfigurationError`, `NotImplementedError`) → 503 con `error` nel body.
// Header `x-correlation-id` sempre presente (riusa quello in ingresso se ben formato, altrimenti
// ne genera uno).
//
// È una rotta pubblica, e allora dice poco a chi non conosce: stato aggregato e stato per porta.
// Il dettaglio — DSN e versione del database Infinity, messaggi del driver, testo degli errori di
// configurazione — è ricognizione per chi vuole attaccare quei sistemi, e lo vede solo chi ha una
// sessione o il segreto del cron. Ogni chiamata con `probe=dependencies` costa una connessione
// verso Infinity: un tetto di frequenza impedisce di farne un martello.
import { NextResponse, type NextRequest } from 'next/server';
import { readApiSession } from '@/app/_server/session';
import { getContainer } from '@/config/container';
import {
  checkExternalHealth,
  isStartupError,
  providerKindsFromEnv,
  unavailableHealth,
  type SystemHealth,
  type SystemHealthUnavailable,
} from '@/application/health/check-health';
import { acceptedCorrelationId } from '@/lib/http/correlation-id';
import { clientIpFrom, hitRateLimit } from '@/lib/http/rate-limit';
import { secretsMatch } from '@/lib/http/secrets';

export const dynamic = 'force-dynamic';

/** Quello che vede chi non è autenticato: stato aggregato e stato per porta, niente dettagli. */
export interface PublicSystemHealth {
  readonly status: SystemHealth['status'];
  readonly checkedAt: SystemHealth['checkedAt'];
  readonly providers: readonly { readonly provider: string; readonly status: string }[];
}

type HealthResponse = SystemHealth | SystemHealthUnavailable | PublicSystemHealth;

/** Ampio per i monitor (una sonda ogni pochi secondi), stretto per chi lo martella. */
const LIMITE = { limit: 120, windowMs: 60_000 } as const;

export function redactHealth(health: SystemHealth): PublicSystemHealth {
  return {
    status: health.status,
    checkedAt: health.checkedAt,
    providers: health.providers.map((p) => ({ provider: p.provider, status: p.status })),
  };
}

export async function GET(request: NextRequest): Promise<NextResponse<HealthResponse>> {
  const probeDependencies = request.nextUrl.searchParams.get('probe') === 'dependencies';
  const incomingCorrelationId = acceptedCorrelationId(request.headers.get('x-correlation-id'));

  const limite = hitRateLimit(`health:${clientIpFrom(request.headers) ?? 'globale'}`, LIMITE);
  if (!limite.allowed) {
    return NextResponse.json(
      { status: 'DOWN', checkedAt: null, providers: [] } satisfies PublicSystemHealth,
      { status: 429, headers: { 'retry-after': String(limite.retryAfterSeconds) } },
    );
  }

  try {
    const container = getContainer();
    const correlationId = incomingCorrelationId ?? container.ids.next();
    const privilegiato =
      secretsMatch(request.headers.get('x-cron-secret'), container.env.cronSecret) ||
      (await readApiSession(request)) !== null;
    const health = await checkExternalHealth(container.external, {
      clock: container.clock,
      kinds: providerKindsFromEnv(container.env),
      correlationId,
    });
    const httpStatus = probeDependencies && health.status === 'DOWN' ? 503 : 200;
    return NextResponse.json(privilegiato ? health : redactHealth(health), {
      status: httpStatus,
      headers: { 'x-correlation-id': correlationId, 'cache-control': 'no-store' },
    });
  } catch (error) {
    if (!isStartupError(error)) {
      throw error;
    }
    // Il container non esiste: `IIdGenerator` non è disponibile, quindi si ricorre a `crypto` nativo
    // (unica eccezione ammessa alla regola "nessun crypto diretto fuori da UuidIdGenerator").
    const correlationId = incomingCorrelationId ?? globalThis.crypto.randomUUID();
    // Errore visibile nei log del server; al chiamante anonimo resta solo il nome dell'errore.
    console.error(`[health] container non disponibile (${error.name}): ${error.message}`);
    const completo = unavailableHealth(error);
    return NextResponse.json(
      {
        ...completo,
        error: {
          name: completo.error.name,
          message: 'Configurazione non valida: vedere i log del server.',
        },
      },
      { status: 503, headers: { 'x-correlation-id': correlationId, 'cache-control': 'no-store' } },
    );
  }
}
