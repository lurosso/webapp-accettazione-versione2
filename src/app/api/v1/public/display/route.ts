// GET /api/v1/public/display?campata=1   (alias accettati: ?bay=, ?bayCode=; valori "1" o "C1")
//
// Stato del monitor appeso sopra una campata (modulo D). Endpoint PUBBLICO: i monitor sono kiosk
// in rete locale senza sessione. Espone solo codice di prenotazione e targa, cioè esattamente
// quello che il cliente legge sullo schermo davanti a sé; nessun nome né telefono.
//
// Token: ogni campata ha un `displayToken` nel seed. Se il monitor lo passa in `?token=` viene
// verificato (403 se sbagliato). Se non lo passa l'accesso è consentito, perché in officina i
// monitor sono su rete interna: l'obbligatorietà arriverà con l'hardening di M6.
//
// Codici: 200 stato · 400 parametro mancante · 403 token errato · 404 campata sconosciuta · 503
// configurazione non valida.
import { NextResponse, type NextRequest } from 'next/server';
import { isStartupError, type SystemHealthUnavailable } from '@/application/health/check-health';
import { getContainer } from '@/config/container';
import type { BayDisplayView } from '@/domain/read-models';
import {
  badRequestResponse,
  domainErrorResponse,
  forbiddenResponse,
  type ApiErrorBody,
} from '@/lib/http/api-error';
import { clientIpFrom, hitRateLimit, type RateLimitRule } from '@/lib/http/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * Tetto molto alto: ogni monitor interroga ogni 2 s (30 richieste/min) e in officina più monitor
 * possono uscire dallo stesso indirizzo. Serve solo a fermare un abuso grossolano, non i kiosk.
 */
const PER_IP: RateLimitRule = { limit: 900, windowMs: 60_000 };

/** Risposta del monitor di campata. */
export interface DisplayStatusResponse {
  readonly display: BayDisplayView;
  readonly serverTime: string;
  readonly timeZone: string;
}

type DisplayBody = DisplayStatusResponse | ApiErrorBody | SystemHealthUnavailable;

const NO_STORE = { 'cache-control': 'no-store' } as const;

export async function GET(request: NextRequest): Promise<NextResponse<DisplayBody>> {
  const { searchParams } = request.nextUrl;
  const bayRef = (
    searchParams.get('campata') ??
    searchParams.get('bay') ??
    searchParams.get('bayCode') ??
    ''
  ).trim();
  if (bayRef === '') {
    return badRequestResponse(
      'Indicare la postazione di accettazione (parametro `campata`, es. 1 oppure C1).',
    );
  }

  const limit = hitRateLimit(`display-ip:${clientIpFrom(request.headers)}`, PER_IP);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST' as const, message: 'Troppe richieste.' } },
      { status: 429, headers: { ...NO_STORE, 'retry-after': String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const container = getContainer();
    const result = await container.queueService.getBayDisplay(bayRef, container.clock.today());
    if (!result.ok) {
      return domainErrorResponse(result.error, { ...NO_STORE });
    }

    // Verifica del token solo se il monitor lo fornisce (vedi nota in testa al file).
    const token = searchParams.get('token');
    if (token !== null && token.trim() !== '') {
      const bay = await container.repos.referenceData.findBayByCode(result.value.bayCode);
      if (bay === null || bay.displayToken !== token.trim()) {
        return forbiddenResponse('Token del display non valido per questa accettazione.');
      }
    }

    return NextResponse.json(
      {
        display: result.value,
        serverTime: container.clock.nowIso(),
        timeZone: container.env.timeZone,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (!isStartupError(error)) {
      throw error;
    }
    console.error(`[public/display] container non disponibile (${error.name}): ${error.message}`);
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL' as const,
          message: 'Servizio momentaneamente non disponibile.',
        },
      },
      { status: 503, headers: NO_STORE },
    );
  }
}
