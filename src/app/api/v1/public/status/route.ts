// GET /api/v1/public/status?targa=AB123CD  (alias accettato: ?plate=)
//
// Endpoint PUBBLICO del portale cliente (modulo B): nessuna sessione, raggiungibile dal QR code.
// Risponde solo con dati non personali (codice, stato, clienti in attesa, campata, marchio, orari):
// nomi, telefoni e modello del veicolo non escono mai da qui.
//
// Codici: 200 stato trovato · 400 targa mancante o formato non valido · 404 targa non in agenda
// oggi · 429 troppe richieste (anti-enumerazione) · 503 configurazione non valida.
import { NextResponse, type NextRequest } from 'next/server';
import { isStartupError, type SystemHealthUnavailable } from '@/application/health/check-health';
import { PUBLIC_STATUS_RATE_LIMIT } from '@/config/constants';
import { getContainer } from '@/config/container';
import type { QueuePositionView } from '@/domain/read-models';
import { badRequestResponse, domainErrorResponse, type ApiErrorBody } from '@/lib/http/api-error';
import { clientIpFrom, hitRateLimit, type RateLimitRule } from '@/lib/http/rate-limit';

export const dynamic = 'force-dynamic';

// Anti-abuso: i limiti stanno in `config/constants.ts` perché devono restare coerenti con il
// periodo di polling della pagina di stato (un test lo verifica).
const PER_IP: RateLimitRule = {
  limit: PUBLIC_STATUS_RATE_LIMIT.perIp,
  windowMs: PUBLIC_STATUS_RATE_LIMIT.windowMs,
};
const PER_PLATE: RateLimitRule = {
  limit: PUBLIC_STATUS_RATE_LIMIT.perPlate,
  windowMs: PUBLIC_STATUS_RATE_LIMIT.windowMs,
};

/** Risposta del portale: la posizione in coda, senza alcun dato personale. */
export interface PublicStatusResponse {
  readonly position: QueuePositionView;
  /** Istante del server: la UI mostra "aggiornato alle …" anche se il polling rallenta. */
  readonly serverTime: string;
  readonly timeZone: string;
}

type PublicStatusBody = PublicStatusResponse | ApiErrorBody | SystemHealthUnavailable;

const NO_STORE = { 'cache-control': 'no-store' } as const;

export async function GET(request: NextRequest): Promise<NextResponse<PublicStatusBody>> {
  const { searchParams } = request.nextUrl;
  // `targa` è il nome usato dal QR e dalla UI italiana; `plate` resta accettato per le integrazioni.
  const raw = (searchParams.get('targa') ?? searchParams.get('plate') ?? '').trim();
  if (raw === '') {
    return badRequestResponse('Indicare la targa del veicolo (parametro `targa`).');
  }

  const ipCheck = hitRateLimit(`ip:${clientIpFrom(request.headers)}`, PER_IP);
  const plateCheck = ipCheck.allowed
    ? hitRateLimit(`targa:${raw.toUpperCase().replace(/[\s\-.]/g, '')}`, PER_PLATE)
    : ipCheck;
  if (!ipCheck.allowed || !plateCheck.allowed) {
    const retryAfter = Math.max(ipCheck.retryAfterSeconds, plateCheck.retryAfterSeconds);
    return NextResponse.json(
      {
        error: {
          code: 'BAD_REQUEST' as const,
          message: 'Troppe richieste: riprova fra qualche istante.',
        },
      },
      { status: 429, headers: { ...NO_STORE, 'retry-after': String(retryAfter) } },
    );
  }

  try {
    const container = getContainer();
    const result = await container.queueService.getPublicPositionByPlate(
      raw,
      container.clock.today(),
    );
    if (!result.ok) {
      return domainErrorResponse(result.error, { ...NO_STORE });
    }
    return NextResponse.json(
      {
        position: result.value,
        serverTime: container.clock.nowIso(),
        timeZone: container.env.timeZone,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (!isStartupError(error)) {
      throw error;
    }
    // Configurazione rifiutata: al cliente non si mostrano dettagli tecnici, li vede solo il log.
    console.error(`[public/status] container non disponibile (${error.name}): ${error.message}`);
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL' as const,
          message: 'Servizio momentaneamente non disponibile. Rivolgiti allo sportello.',
        },
      },
      { status: 503, headers: NO_STORE },
    );
  }
}
