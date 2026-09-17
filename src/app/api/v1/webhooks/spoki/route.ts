// POST /api/v1/webhooks/spoki — risposte del cliente su WhatsApp («Arrivato», «In ritardo»,
// «Assente»).
//
// Endpoint PUBBLICO chiamato da Spoki quando il cliente tocca uno dei tre pulsanti del messaggio
// del mattino. Non c'è sessione: l'autenticazione è il segreto condiviso `SPOKI_INBOUND_SECRET`,
// che Spoki manda nel corpo (`secret`) o nell'intestazione `x-spoki-secret` e che si confronta a
// tempo costante. Senza segreto configurato la rotta risponde 404: un webhook aperto sull'agenda
// dell'officina è peggio di un webhook spento.
//
// Il corpo cambia da automazione ad automazione, quindi si accettano più nomi per gli stessi tre
// dati: numero, testo della risposta, codice della pratica (se c'è).
//
// Codici: 200 risposta applicata oppure ignorata (`handled: false`) — un provider ritenta sui
// codici diversi da 2xx, e ritentare non cambierebbe nulla se il testo non è una delle tre
// risposte · 400 corpo non valido · 403 segreto errato · 404 webhook non configurato ·
// 429 troppe richieste · 409 conflitto sulla pratica.
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { correlationIdFrom } from '@/app/_server/session';
import { getContainer } from '@/config/container';
import { badRequestResponse, domainErrorResponse, forbiddenResponse } from '@/lib/http/api-error';
import { clientIpFrom, hitRateLimit, type RateLimitRule } from '@/lib/http/rate-limit';
import { secretsMatch } from '@/lib/http/secrets';

export const dynamic = 'force-dynamic';

/** Tetto generoso: una campagna del mattino può far rispondere molti clienti negli stessi minuti. */
const PER_IP: RateLimitRule = { limit: 300, windowMs: 60_000 };

const NO_STORE = { 'cache-control': 'no-store' } as const;

const Body = z.object({
  secret: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(32).optional(),
  telefono: z.string().trim().max(32).optional(),
  from: z.string().trim().max(32).optional(),
  text: z.string().trim().max(500).optional(),
  testo: z.string().trim().max(500).optional(),
  message: z.string().trim().max(500).optional(),
  reply: z.string().trim().max(500).optional(),
  button: z.string().trim().max(500).optional(),
  answer: z.string().trim().max(500).optional(),
  code: z.string().trim().max(16).optional(),
  codice: z.string().trim().max(16).optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const container = getContainer();
  const atteso = container.env.spokiInboundSecret;
  if (atteso === null) {
    // Funzione non configurata: si comporta come una rotta che non esiste.
    return NextResponse.json(
      { error: { code: 'NOT_FOUND' as const, message: 'Webhook non attivo.' } },
      { status: 404, headers: NO_STORE },
    );
  }

  const limite = hitRateLimit(`spoki-in:${clientIpFrom(request.headers)}`, PER_IP);
  if (!limite.allowed) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST' as const, message: 'Troppe richieste.' } },
      { status: 429, headers: { ...NO_STORE, 'retry-after': String(limite.retryAfterSeconds) } },
    );
  }

  const raw: unknown = await request.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return badRequestResponse('Corpo del webhook non valido.', { issues: parsed.error.issues });
  }
  const body = parsed.data;

  const fornito = request.headers.get('x-spoki-secret') ?? body.secret ?? null;
  if (!secretsMatch(fornito, atteso)) {
    return forbiddenResponse('Segreto del webhook non valido.');
  }

  const phone = body.phone ?? body.telefono ?? body.from ?? '';
  const text =
    body.reply ?? body.button ?? body.answer ?? body.text ?? body.testo ?? body.message ?? '';
  if (phone === '') {
    return badRequestResponse('Numero di telefono mancante (campo `phone`).');
  }

  const correlationId = correlationIdFrom(request);
  const esito = await container.whatsAppInboundService.handle({
    phone,
    text,
    code: body.code ?? body.codice ?? null,
    correlationId,
  });
  const headers = { ...NO_STORE, 'x-correlation-id': correlationId };

  if (!esito.ok) {
    // Testo non riconosciuto o nessuna pratica oggi: non è un guasto e ritentare non aiuta.
    if (esito.error.code === 'VALIDATION' || esito.error.code === 'NOT_FOUND') {
      return NextResponse.json(
        { handled: false, reason: esito.error.code },
        { status: 200, headers },
      );
    }
    return domainErrorResponse(esito.error, headers);
  }

  // Al provider torna il minimo indispensabile: nessun nome, nessun telefono, nessuna targa.
  return NextResponse.json(
    {
      handled: true,
      reply: esito.value.reply,
      code: esito.value.appointment.code,
      repeated: esito.value.repeated,
      replySent: esito.value.replySent,
    },
    { headers },
  );
}
