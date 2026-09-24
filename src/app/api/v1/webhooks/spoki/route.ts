// POST /api/v1/webhooks/spoki — tutto quello che Spoki manda all'officina:
// - gli ESITI di consegna dei messaggi in uscita (evento V2 `message.outbound`: inviato,
//   consegnato, letto, fallito), che aggiornano il job della notifica e lo stato WhatsApp della
//   pratica visibile in coda e in archivio;
// - i MESSAGGI del cliente (evento V2 `message.inbound`, oppure la forma piatta delle automazioni):
//   «Arrivato», «In ritardo», «Assente».
//
// Le automazioni Spoki dei tre pulsanti (docs/SPOKI.md) chiamano questa rotta dal loro passo
// «webhook» con `source: "automation"`: al cliente risponde l'automazione, quindi qui si registra il
// fatto e si restituiscono `esito` (una parola) e `risposta` (il testo che spetta al cliente, con
// codice e link personale), che Spoki salva nei campi del contatto e consegna. Se questa rotta non
// risponde, l'automazione manda il suo testo di riserva: il cliente ha comunque una risposta.
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
import {
  automationOutcomeOf,
  type InboundChannel,
} from '@/application/notifications/WhatsAppInboundService';

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
  /** "automation" quando chiama il passo «webhook» di un'automazione Spoki. */
  source: z.string().trim().max(32).optional(),
});

/**
 * Un campo che Spoki non ha potuto riempire (il contatto non ha quel campo) resta scritto com'era
 * nel modello del passo: `%%ACC_CODICE%%` o `{{ contact.phone }}`. Vale come assente.
 */
function valore(v: string | undefined): string | undefined {
  if (v === undefined) {
    return undefined;
  }
  const t = v.trim();
  return t === '' || /^%%[A-Z0-9_]+%%$/.test(t) || /^\{\{.*\}\}$/.test(t) ? undefined : t;
}

function nonAttivo(): NextResponse {
  return NextResponse.json(
    { error: { code: 'NOT_FOUND' as const, message: 'Webhook non attivo.' } },
    { status: 404, headers: NO_STORE },
  );
}

/**
 * Firma V2 valida oppure segreto condiviso uguale a uno dei segreti di SPOKI_WEBHOOK_SECRET (Spoki
 * ne genera uno per webhook, e ogni webhook porta un solo evento). Si provano tutti: il confronto
 * resta a tempo costante per ciascuno.
 */
function autenticaEvento(
  container: Container,
  request: NextRequest,
  rawBody: string,
  bodySecret: string | null,
): boolean {
  const firma = request.headers.get('x-spoki-signature');
  const condiviso = request.headers.get('x-spoki-secret') ?? bodySecret;
  const adesso = container.clock.now().getTime();
  let valido = false;
  for (const segreto of container.env.spokiWebhookSecrets) {
    const firmaOk = verifySpokiSignature(rawBody, firma, segreto, adesso).ok;
    const condivisoOk = secretsMatch(condiviso, segreto);
    valido = valido || firmaOk || condivisoOk;
  }
  return valido;
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
            channel: 'EVENT',
            // Il payload c'è solo quando il cliente ha toccato un pulsante del template.
            viaButton: evento.value.payload !== null,
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
  const phone = valore(body.phone) ?? valore(body.telefono) ?? valore(body.from) ?? '';
  const text =
    valore(body.reply) ??
    valore(body.button) ??
    valore(body.answer) ??
    valore(body.text) ??
    valore(body.testo) ??
    valore(body.message) ??
    '';
  if (phone === '') {
    return badRequestResponse('Numero di telefono mancante (campo `phone`).');
  }
  const automazione = body.source?.toLowerCase() === 'automation';
  return rispostaCliente(
    container,
    {
      phone,
      text,
      code: valore(body.code) ?? valore(body.codice) ?? null,
      channel: automazione ? 'AUTOMATION' : 'MANUAL',
      // L'automazione parte dal tocco su un pulsante; la forma manuale può essere testo libero.
      viaButton: automazione,
    },
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
  input: {
    readonly phone: string;
    readonly text: string;
    readonly code: string | null;
    readonly channel: InboundChannel;
    readonly viaButton: boolean;
  },
  correlationId: string,
  headers: Readonly<Record<string, string>>,
): Promise<NextResponse> {
  const esito = await container.whatsAppInboundService.handle({ ...input, correlationId });
  if (!esito.ok) {
    // Testo non riconosciuto o nessuna pratica oggi: non è un guasto e ritentare non aiuta.
    // All'automazione si dice anche che non c'è niente da rispondere (`risposta` vuota).
    if (esito.error.code === 'VALIDATION' || esito.error.code === 'NOT_FOUND') {
      return NextResponse.json(
        {
          handled: false,
          reason: esito.error.code,
          esito: esito.error.code === 'NOT_FOUND' ? 'NESSUNA_PRATICA' : 'NON_RICONOSCIUTO',
          risposta: '',
        },
        { status: 200, headers },
      );
    }
    return domainErrorResponse(esito.error, headers);
  }
  // Al provider torna il minimo indispensabile: nessun nome, nessun telefono, nessuna targa. Solo
  // quando risponde Spoki si aggiunge il testo per il cliente (codice e link, che il contatto in
  // Spoki ha già nei suoi campi).
  const r = esito.value;
  return NextResponse.json(
    {
      handled: true,
      reply: r.reply,
      code: r.appointment.code,
      repeated: r.repeated,
      replySent: r.replySent,
      premature: r.premature,
      replyBy: r.replyBy,
      esito: automationOutcomeOf(r),
      risposta: r.replyBy === 'SPOKI' ? (r.replyText ?? '') : '',
    },
    { headers },
  );
}
