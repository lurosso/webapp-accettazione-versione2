// GET /api/v1/health: liveness del processo + HealthStatus aggregato delle quattro porte esterne.
//
// Codici HTTP (ARCHITECTURE.md §6.6):
// - senza parametri → sempre 200 finché il processo risponde (probe di liveness per Docker/monitor:
//   una dipendenza esterna giù NON deve far riavviare l'app, che continua con i fallback manuali);
// - `?probe=dependencies` → 503 quando lo stato aggregato è `DOWN` (readiness delle dipendenze);
// - container non costruibile (`ConfigurationError`, `NotImplementedError`) → 503 con `error` nel body.
// Header `x-correlation-id` sempre presente (riusa quello in ingresso, altrimenti ne genera uno).
import { NextResponse } from 'next/server';
import { getContainer } from '@/config/container';
import {
  checkExternalHealth,
  isStartupError,
  providerKindsFromEnv,
  unavailableHealth,
  type SystemHealth,
  type SystemHealthUnavailable,
} from '@/application/health/check-health';

export const dynamic = 'force-dynamic';

type HealthResponse = SystemHealth | SystemHealthUnavailable;

export async function GET(request: Request): Promise<NextResponse<HealthResponse>> {
  const probeDependencies = new URL(request.url).searchParams.get('probe') === 'dependencies';
  const incomingCorrelationId = request.headers.get('x-correlation-id');

  try {
    const container = getContainer();
    // In attesa di `lib/http/with-logging.ts` (M1-T08-S02b) l'id è generato qui dal container.
    const correlationId = incomingCorrelationId ?? container.ids.next();
    const health = await checkExternalHealth(container.external, {
      clock: container.clock,
      kinds: providerKindsFromEnv(container.env),
      correlationId,
    });
    const httpStatus = probeDependencies && health.status === 'DOWN' ? 503 : 200;
    return NextResponse.json(health, {
      status: httpStatus,
      headers: { 'x-correlation-id': correlationId },
    });
  } catch (error) {
    if (!isStartupError(error)) {
      throw error;
    }
    // Il container non esiste: `IIdGenerator` non è disponibile, quindi si ricorre a `crypto` nativo
    // (unica eccezione ammessa alla regola "nessun crypto diretto fuori da UuidIdGenerator").
    const correlationId = incomingCorrelationId ?? globalThis.crypto.randomUUID();
    // Errore visibile anche nei log del server, non solo nel JSON.
    console.error(`[health] container non disponibile (${error.name}): ${error.message}`);
    return NextResponse.json(unavailableHealth(error), {
      status: 503,
      headers: { 'x-correlation-id': correlationId },
    });
  }
}
