// POST /api/v1/public/arrival — "Sono arrivato" dalla pagina di tracciamento del cliente.
//
// Endpoint PUBBLICO, gemello di `late-notice`: il cliente si identifica con la targa e/o con il
// token del link, come per lo stato. Registra l'ora dell'arrivo e restituisce lo stato aggiornato.
// Non cambia lo stato della pratica né l'ordine della coda: dice solo all'accettazione che quel
// cliente è in sala.
//
// Idempotente: un secondo tocco (rete lenta, pulsante premuto due volte, prima la pagina e poi la
// risposta su WhatsApp) risponde 200 con `registered: false` e l'ora già registrata. Anche una
// pratica ormai allo sportello o conclusa risponde 200 senza toccare nulla: è un tocco arrivato
// tardi, non un errore da mostrare a chi sta aspettando.
//
// Codici: 200 arrivo registrato o già presente · 400 dati non validi · 404 targa/token non in
// agenda · 429 troppe richieste.
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { PUBLIC_LATE_NOTICE_RATE_LIMIT } from '@/config/constants';
import { getContainer } from '@/config/container';
import { badRequestResponse, publicErrorResponse } from '@/lib/http/api-error';
import {
  combineRateLimits,
  hitPerIp,
  hitRateLimit,
  type RateLimitRule,
} from '@/lib/http/rate-limit';
import { publicLookupKey } from '../status/route';

export const dynamic = 'force-dynamic';

/** Stessi limiti della segnalazione di ritardo: è un tocco, non un'interrogazione. */
const PER_IP: RateLimitRule = {
  limit: PUBLIC_LATE_NOTICE_RATE_LIMIT.perIp,
  windowMs: PUBLIC_LATE_NOTICE_RATE_LIMIT.windowMs,
};
const PER_SUBJECT: RateLimitRule = {
  limit: PUBLIC_LATE_NOTICE_RATE_LIMIT.perPlate,
  windowMs: PUBLIC_LATE_NOTICE_RATE_LIMIT.windowMs,
};
const GLOBALE: RateLimitRule = {
  limit: PUBLIC_LATE_NOTICE_RATE_LIMIT.global,
  windowMs: PUBLIC_LATE_NOTICE_RATE_LIMIT.windowMs,
};

const Body = z.object({
  targa: z.string().trim().max(16).optional(),
  plate: z.string().trim().max(16).optional(),
  t: z.string().trim().max(64).optional(),
});

const NO_STORE = { 'cache-control': 'no-store' } as const;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const raw: unknown = await request.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return badRequestResponse("Dati dell'arrivo non validi.", { issues: parsed.error.issues });
  }
  const plate = parsed.data.targa ?? parsed.data.plate ?? '';
  const token = parsed.data.t ?? '';
  if (plate === '' && token === '') {
    return badRequestResponse('Indicare la targa del veicolo (campo `targa`).');
  }

  const ipCheck = combineRateLimits(
    hitRateLimit('portale-scritture:globale', GLOBALE),
    hitPerIp('arrivo-ip', request.headers, PER_IP),
  );
  const subjectCheck = ipCheck.allowed
    ? hitRateLimit(`arrivo-${publicLookupKey(plate, token)}`, PER_SUBJECT)
    : ipCheck;
  if (!ipCheck.allowed || !subjectCheck.allowed) {
    const retryAfter = Math.max(ipCheck.retryAfterSeconds, subjectCheck.retryAfterSeconds);
    return NextResponse.json(
      {
        error: {
          code: 'BAD_REQUEST' as const,
          message: 'Hai già avvisato da poco: riprova fra qualche minuto.',
        },
      },
      { status: 429, headers: { ...NO_STORE, 'retry-after': String(retryAfter) } },
    );
  }

  const container = getContainer();
  const result = await container.customerPortalService.registerArrival({ plate, token }, 'PORTAL');
  if (!result.ok) {
    return publicErrorResponse(result.error, { ...NO_STORE });
  }
  return NextResponse.json(
    {
      position: result.value.status,
      registered: result.value.registered,
      serverTime: container.clock.nowIso(),
      timeZone: container.env.timeZone,
    },
    { headers: NO_STORE },
  );
}
