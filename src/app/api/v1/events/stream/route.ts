// GET /api/v1/events/stream — eventi in tempo reale per l'area operatore (SSE).
// Il client riceve un segnale ("è cambiato qualcosa, di questo tipo, su questa pratica") e rilegge
// dai propri endpoint: i dati non passano mai da qui. Il polling resta attivo come rete di
// sicurezza, quindi una connessione che cade rallenta gli aggiornamenti, non li ferma.
import type { NextRequest } from 'next/server';
import { readApiSession } from '@/app/_server/session';
import { getContainer } from '@/config/container';
import { unauthorizedResponse } from '@/lib/http/api-error';
import { createEventStream, parseLastEventId, SSE_HEADERS } from '@/lib/realtime/sse';

export const dynamic = 'force-dynamic';
// Flusso lungo: deve girare nel runtime Node, dove vive il bus in-process.
export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<Response> {
  const session = await readApiSession(request);
  if (session === null) {
    return unauthorizedResponse();
  }

  const stream = createEventStream({
    bus: getContainer().eventBus,
    signal: request.signal,
    lastEventId: parseLastEventId(
      request.headers.get('last-event-id'),
      request.nextUrl.searchParams.get('since'),
    ),
    includeIds: true,
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
