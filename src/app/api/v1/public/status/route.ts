// GET /api/v1/public/status?targa=AB123CD[&t=token]  (alias accettato: ?plate=)
//
// Endpoint PUBBLICO del portale cliente (modulo B): nessuna sessione, raggiungibile dal QR code o
// dal link WhatsApp. Il cliente si identifica con la targa oppure con il token unico della pratica
// (`t`, HMAC dell'id con il segreto del server): niente form di login. Risponde solo con dati non
// personali (codice, stato, tappa del percorso, clienti in attesa, campata, sportello, accettatore,
// orari): nomi e telefoni dei clienti non escono mai da qui.
//
// Codici: 200 stato trovato · 400 targa mancante o formato non valido · 404 targa o token non in
// agenda (oggi o ieri) · 429 troppe richieste (anti-enumerazione) · 503 configurazione non valida.
import { NextResponse, type NextRequest } from 'next/server';
import { isStartupError, type SystemHealthUnavailable } from '@/application/health/check-health';
import { PUBLIC_STATUS_RATE_LIMIT } from '@/config/constants';
import { getContainer } from '@/config/container';
import type { PortalStatusView } from '@/domain/read-models';
import { badRequestResponse, publicErrorResponse, type ApiErrorBody } from '@/lib/http/api-error';
import {
  combineRateLimits,
  hitPerIp,
  hitRateLimit,
  type RateLimitRule,
} from '@/lib/http/rate-limit';

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
const GLOBALE: RateLimitRule = {
  limit: PUBLIC_STATUS_RATE_LIMIT.global,
  windowMs: PUBLIC_STATUS_RATE_LIMIT.windowMs,
};

/** Lunghezze massime dei parametri: oltre non è una targa né un token, e non deve diventare una chiave del limitatore. */
const MAX_PLATE_PARAM = 16;
const MAX_TOKEN_PARAM = 64;

/** Risposta del portale: lo stato della pratica, senza alcun dato personale del cliente. */
export interface PublicStatusResponse {
  readonly position: PortalStatusView;
  /** Istante del server: la UI mostra "aggiornato alle …" anche se il polling rallenta. */
  readonly serverTime: string;
  readonly timeZone: string;
}

type PublicStatusBody = PublicStatusResponse | ApiErrorBody | SystemHealthUnavailable;

const NO_STORE = { 'cache-control': 'no-store' } as const;

/** Chiave del limite per soggetto cercato: la targa normalizzata o il token del link. */
export function publicLookupKey(plate: string, token: string): string {
  return plate !== '' ? `targa:${plate.toUpperCase().replace(/[\s\-.]/g, '')}` : `token:${token}`;
}

export async function GET(request: NextRequest): Promise<NextResponse<PublicStatusBody>> {
  const { searchParams } = request.nextUrl;
  // `targa` è il nome usato dal QR e dalla UI italiana; `plate` resta accettato per le integrazioni.
  const plate = (searchParams.get('targa') ?? searchParams.get('plate') ?? '').trim();
  const token = (searchParams.get('t') ?? '').trim();
  if (plate === '' && token === '') {
    return badRequestResponse('Indicare la targa del veicolo (parametro `targa`).');
  }
  if (plate.length > MAX_PLATE_PARAM || token.length > MAX_TOKEN_PARAM) {
    return badRequestResponse('Parametri non validi.');
  }

  // Tre contatori: globale (rete di sicurezza contro chi ruota indirizzi), per indirizzo (solo
  // dietro un proxy fidato) e per soggetto cercato.
  const ipCheck = combineRateLimits(
    hitRateLimit('public-status:globale', GLOBALE),
    hitPerIp('ip', request.headers, PER_IP),
  );
  const subjectCheck = ipCheck.allowed
    ? hitRateLimit(publicLookupKey(plate, token), PER_PLATE)
    : ipCheck;
  if (!ipCheck.allowed || !subjectCheck.allowed) {
    const retryAfter = Math.max(ipCheck.retryAfterSeconds, subjectCheck.retryAfterSeconds);
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
    const result = await container.customerPortalService.getStatus({ plate, token });
    if (!result.ok) {
      return publicErrorResponse(result.error, { ...NO_STORE });
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
