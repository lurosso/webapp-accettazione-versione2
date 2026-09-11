// GET /api/v1/public/events/stream — eventi in tempo reale per i monitor e il tabellone (SSE).
//
// Endpoint PUBBLICO come gli altri `public/`: i kiosk in officina non hanno una sessione. Per
// questo trasmette solo il TIPO dell'evento, senza identificativi: chi ascolta capisce che deve
// rileggere `public/display` o `public/board`, e da lì riceve quello che è autorizzato a mostrare.
// Sono esclusi anche i tipi che non servono a uno schermo (notifiche, consegne al CRM).
import type { NextRequest } from 'next/server';
import { getContainer } from '@/config/container';
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
