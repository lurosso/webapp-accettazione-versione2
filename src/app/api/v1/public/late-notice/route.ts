// POST /api/v1/public/late-notice — "Sto arrivando in ritardo (+10 min)" dal portale cliente.
//
// Endpoint PUBBLICO: il cliente si identifica con la targa e/o con il token del link WhatsApp,
// come per lo stato. È l'unica azione concessa al cliente: sposta l'arrivo atteso, pubblica
// l'evento per la dashboard (avviso ambra) e restituisce lo stato aggiornato. Non cambia l'ordine
// della coda. Limiti di frequenza stretti: un cliente lo tocca una volta, non trenta.
//
// Codici: 200 avviso registrato (o già presente entro il tempo minimo) · 400 dati non validi ·
// 404 targa/token non in agenda · 409 pratica non più in attesa · 429 troppe richieste.
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { CUSTOMER_LATE_NOTICE_MINUTES, PUBLIC_LATE_NOTICE_RATE_LIMIT } from '@/config/constants';
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
  minutes: z.number().int().min(5).max(120).optional(),
});

const NO_STORE = { 'cache-control': 'no-store' } as const;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const raw: unknown = await request.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return badRequestResponse('Dati della segnalazione non validi.', {
      issues: parsed.error.issues,
    });
  }
  const plate = parsed.data.targa ?? parsed.data.plate ?? '';
  const token = parsed.data.t ?? '';
  if (plate === '' && token === '') {
    return badRequestResponse('Indicare la targa del veicolo (campo `targa`).');
  }

  const ipCheck = combineRateLimits(
    hitRateLimit('portale-scritture:globale', GLOBALE),
    hitPerIp('late-ip', request.headers, PER_IP),
  );
  const subjectCheck = ipCheck.allowed
    ? hitRateLimit(`late-${publicLookupKey(plate, token)}`, PER_SUBJECT)
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
  const result = await container.customerPortalService.reportDelay(
    { plate, token },
    parsed.data.minutes ?? CUSTOMER_LATE_NOTICE_MINUTES,
  );
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
}
