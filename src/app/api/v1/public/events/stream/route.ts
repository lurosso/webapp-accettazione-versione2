// GET /api/v1/public/events/stream — eventi in tempo reale per i monitor e il tabellone (SSE).
//
// Endpoint PUBBLICO come gli altri `public/`: i kiosk in officina non hanno una sessione. Per
// questo trasmette solo il TIPO dell'evento, senza identificativi: chi ascolta capisce che deve
// rileggere `public/display` o `public/board`, e da lì riceve quello che è autorizzato a mostrare.
// Sono esclusi anche i tipi che non servono a uno schermo (notifiche, consegne al CRM).
import { NextResponse, type NextRequest } from 'next/server';
import { SSE_CONNECTION_LIMITS } from '@/config/constants';
import { getContainer } from '@/config/container';
import { clientIpFrom } from '@/lib/http/rate-limit';
import { acquireConnection } from '@/lib/realtime/connection-guard';
import { createEventStream, parseLastEventId, SSE_HEADERS } from '@/lib/realtime/sse';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Solo ciò che cambia quello che si vede su uno schermo appeso al muro. */
const TIPI_PUBBLICI = [
  'APPOINTMENT_STATUS_CHANGED',
  'APPOINTMENT_CREATED',
  'BUSINESS_DAY_CLOSED',
] as const;

export async function GET(request: NextRequest): Promise<Response> {
  // Tetto alle connessioni aperte: è l'unico vero vettore di abuso di un canale che non legge né
  // scrive nulla. Oltre il limite si risponde 503 e il monitor resta sul polling.
  const ticket = acquireConnection(
    `sse-public:${clientIpFrom(request.headers)}`,
    SSE_CONNECTION_LIMITS.public,
  );
  if (!ticket.allowed) {
    return NextResponse.json(
      {
        error: {
          code: 'UNAVAILABLE' as const,
          message: 'Troppe connessioni aperte: gli schermi continuano con il polling.',
        },
      },
      { status: 503, headers: { 'retry-after': '30', 'cache-control': 'no-store' } },
    );
  }
  request.signal.addEventListener('abort', ticket.release, { once: true });

  const stream = createEventStream({
    bus: getContainer().eventBus,
    signal: request.signal,
    lastEventId: parseLastEventId(
      request.headers.get('last-event-id'),
      request.nextUrl.searchParams.get('since'),
    ),
    types: TIPI_PUBBLICI,
    includeIds: false,
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
