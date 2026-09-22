// POST /api/v1/webhooks/spoki — tutto quello che Spoki manda all'officina:
// - gli ESITI di consegna dei messaggi in uscita (evento V2 `message.outbound`: inviato,
//   consegnato, letto, fallito), che aggiornano il job della notifica e lo stato WhatsApp della
//   pratica visibile in coda e in archivio;
// - i MESSAGGI del cliente (evento V2 `message.inbound`, oppure la forma piatta delle automazioni):
//   «Arrivato», «In ritardo», «Assente».
//
// Endpoint PUBBLICO, senza sessione. Due modi di autenticare, a tempo costante:
// - gli eventi V2 portano la firma `X-Spoki-Signature: t=…,v2=HMAC-SHA256(SPOKI_WEBHOOK_SECRET,
//   "t.corpo")`, verificata sul corpo grezzo con una finestra di cinque minuti (anti-replay);
//   in alternativa lo stesso segreto può arrivare come segreto condiviso (`x-spoki-secret`);
// - la forma piatta delle risposte del cliente usa il segreto dell'automazione
//   `SPOKI_INBOUND_SECRET` nel corpo (`secret`) o nell'intestazione `x-spoki-secret`.
// Senza segreti configurati — o con `MESSAGING_STANDBY=true`, l'interruttore che mette in pausa
// tutta l'integrazione con il cliente — la rotta risponde 404: un webhook aperto sull'agenda
// dell'officina è peggio di un webhook spento.
//
// Codici: 200 evento applicato oppure ignorato (`handled: false`) — un provider ritenta sui codici
// diversi da 2xx, e ritentare non cambierebbe nulla se il messaggio è sconosciuto o il testo non è
// una delle tre risposte · 400 corpo non valido · 403 firma o segreto errati · 404 webhook non
// configurato · 429 troppe richieste · 409 conflitto sulla pratica.
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { correlationIdFrom } from '@/app/_server/session';
import { getContainer, type Container } from '@/config/container';
import { badRequestResponse, domainErrorResponse, forbiddenResponse } from '@/lib/http/api-error';
import { clientIpFrom, hitRateLimit, type RateLimitRule } from '@/lib/http/rate-limit';
import { secretsMatch } from '@/lib/http/secrets';
import { verifySpokiSignature } from '@/lib/http/spoki-signature';
import { looksLikeSpokiEvent } from '@/services/dto/spoki-webhook.dto';

export const dynamic = 'force-dynamic';

/**
 * Tetto generoso: una campagna del mattino può far rispondere molti clienti negli stessi minuti, e
 * ogni messaggio in uscita porta fino a quattro esiti (inviato, consegnato, letto…).
 */
const PER_IP: RateLimitRule = { limit: 600, windowMs: 60_000 };

const NO_STORE = { 'cache-control': 'no-store' } as const;

/** Forma piatta delle risposte del cliente (le automazioni cambiano i nomi dei campi). */
const Risposta = z.object({
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

function nonAttivo(): NextResponse {
  return NextResponse.json(
    { error: { code: 'NOT_FOUND' as const, message: 'Webhook non attivo.' } },
    { status: 404, headers: NO_STORE },
  );
}

/** Firma V2 valida oppure segreto condiviso uguale a SPOKI_WEBHOOK_SECRET. */
function autenticaEvento(
  container: Container,
  request: NextRequest,
  rawBody: string,
  bodySecret: string | null,
): boolean {
  const segreto = container.env.spokiWebhookSecret;
  if (segreto === null) {
    return false;
  }
  const firma = verifySpokiSignature(
    rawBody,
    request.headers.get('x-spoki-signature'),
    segreto,
    container.clock.now().getTime(),
  );
  if (firma.ok) {
    return true;
  }
  return secretsMatch(request.headers.get('x-spoki-secret') ?? bodySecret, segreto);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const container = getContainer();
  const { spokiInboundSecret, spokiWebhookSecret, messagingStandby } = container.env;
  // Senza nessun segreto, oppure con l'integrazione in standby, la rotta si comporta come una
  // rotta che non esiste: resta nel codice, dormiente, e non tocca l'agenda.
  if ((spokiInboundSecret === null && spokiWebhookSecret === null) || messagingStandby) {
    return nonAttivo();
  }

  const limite = hitRateLimit(`spoki-in:${clientIpFrom(request.headers) ?? 'globale'}`, PER_IP);
  if (!limite.allowed) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST' as const, message: 'Troppe richieste.' } },
      { status: 429, headers: { ...NO_STORE, 'retry-after': String(limite.retryAfterSeconds) } },
    );
  }

  // Il corpo grezzo serve alla firma: un JSON riserializzato non coinciderebbe byte per byte.
  const rawBody = await request.text().catch(() => '');
  let raw: unknown = null;
  try {
    raw = JSON.parse(rawBody);
  } catch {
    raw = null;
  }
  if (typeof raw !== 'object' || raw === null) {
    return badRequestResponse('Corpo del webhook non valido: atteso un oggetto JSON.');
  }
  const correlationId = correlationIdFrom(request);
  const headers = { ...NO_STORE, 'x-correlation-id': correlationId };
  const bodySecret = (() => {
    const s = (raw as Record<string, unknown>)['secret'];
    return typeof s === 'string' ? s : null;
  })();

  // Eventi di Spoki (esiti di consegna, messaggi in entrata V2, altri eventi).
  if (looksLikeSpokiEvent(raw)) {
    if (spokiWebhookSecret === null) {
      return nonAttivo();
    }
    if (!autenticaEvento(container, request, rawBody, bodySecret)) {
      return forbiddenResponse('Firma o segreto del webhook non validi.');
    }
    const evento = container.external.spoki.parseWebhook(raw, headersRecord(request));
    if (!evento.ok) {
      return badRequestResponse(evento.error.message);
    }
    switch (evento.value.kind) {
      case 'DELIVERY': {
        const esito = await container.whatsAppDeliveryService.applyDelivery(
          evento.value,
          correlationId,
        );
        return NextResponse.json(
          esito.handled
            ? { handled: true, state: evento.value.state, status: esito.job.status }
            : { handled: false, reason: esito.reason },
          { headers },
        );
      }
      case 'INBOUND': {
        if (evento.value.from === null) {
          return badRequestResponse('Messaggio in entrata senza numero del mittente.');
        }
        return rispostaCliente(
          container,
          {
            phone: evento.value.from,
            text: evento.value.payload ?? evento.value.text ?? '',
            code: null,
          },
          correlationId,
          headers,
        );
      }
      case 'IGNORED':
        return NextResponse.json(
          { handled: false, reason: 'IGNORED_EVENT', event: evento.value.event },
          { headers },
        );
    }
  }

  // Forma piatta delle risposte del cliente, autenticata dal segreto dell'automazione.
  if (spokiInboundSecret === null) {
    return nonAttivo();
  }
  const parsed = Risposta.safeParse(raw);
  if (!parsed.success) {
    return badRequestResponse('Corpo del webhook non valido.', { issues: parsed.error.issues });
  }
  const body = parsed.data;
  const fornito = request.headers.get('x-spoki-secret') ?? body.secret ?? null;
  if (!secretsMatch(fornito, spokiInboundSecret)) {
    return forbiddenResponse('Segreto del webhook non valido.');
  }
  const phone = body.phone ?? body.telefono ?? body.from ?? '';
  const text =
    body.reply ?? body.button ?? body.answer ?? body.text ?? body.testo ?? body.message ?? '';
  if (phone === '') {
    return badRequestResponse('Numero di telefono mancante (campo `phone`).');
  }
  return rispostaCliente(
    container,
    { phone, text, code: body.code ?? body.codice ?? null },
    correlationId,
    headers,
  );
}

/** Le intestazioni come record semplice, per la porta (che non conosce `Headers`). */
function headersRecord(request: NextRequest): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/** Risposta del cliente («Arrivato», «In ritardo», «Assente») applicata alla pratica. */
async function rispostaCliente(
  container: Container,
  input: { readonly phone: string; readonly text: string; readonly code: string | null },
  correlationId: string,
  headers: Readonly<Record<string, string>>,
): Promise<NextResponse> {
  const esito = await container.whatsAppInboundService.handle({ ...input, correlationId });
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
