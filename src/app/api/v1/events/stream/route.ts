// GET /api/v1/events/stream — eventi in tempo reale per l'area operatore (SSE).
// Il client riceve un segnale ("è cambiato qualcosa, di questo tipo, su questa pratica") e rilegge
// dai propri endpoint: i dati non passano mai da qui. Il polling resta attivo come rete di
// sicurezza, quindi una connessione che cade rallenta gli aggiornamenti, non li ferma.
import { NextResponse, type NextRequest } from 'next/server';
import { readApiSession } from '@/app/_server/session';
import { SSE_CONNECTION_LIMITS } from '@/config/constants';
import { getContainer } from '@/config/container';
import { forbiddenResponse, unauthorizedResponse } from '@/lib/http/api-error';
import { acquireConnection } from '@/lib/realtime/connection-guard';
import { createEventStream, parseLastEventId, SSE_HEADERS } from '@/lib/realtime/sse';

export const dynamic = 'force-dynamic';
// Flusso lungo: deve girare nel runtime Node, dove vive il bus in-process.
export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<Response> {
  const session = await readApiSession(request);
  if (session === null) {
    return unauthorizedResponse();
  }
  if (session.role === 'KIOSK') {
    return forbiddenResponse(
      'Il flusso eventi degli operatori non è disponibile per i dispositivi kiosk.',
    );
  }

  // Una postazione apre una connessione per scheda: dodici per operatore bastano a chi tiene
  // aperte coda, tablet e cruscotto insieme, e fermano una scheda impazzita.
  const ticket = acquireConnection(`sse-op:${session.operatorId}`, SSE_CONNECTION_LIMITS.operator);
  if (!ticket.allowed) {
    return NextResponse.json(
      {
        error: {
          code: 'UNAVAILABLE' as const,
          message: 'Troppe connessioni aperte per questa sessione.',
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
    includeIds: true,
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
