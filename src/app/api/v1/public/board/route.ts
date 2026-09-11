// GET /api/v1/public/board?prossimi=4
//
// Tabellone della sala d'attesa (modulo D): codici chiamati ora con la loro destinazione e i
// prossimi turni. Endpoint PUBBLICO come i monitor kiosk, che non hanno una sessione.
// Espone SOLO codici: lo schermo è visibile a tutte le persone in sala, quindi niente targhe
// (che restano sul monitor della singola campata, davanti alla vettura) e niente nomi.
import { NextResponse, type NextRequest } from 'next/server';
import { isStartupError, type SystemHealthUnavailable } from '@/application/health/check-health';
import { PUBLIC_STATUS_RATE_LIMIT } from '@/config/constants';
import { getContainer } from '@/config/container';
import type { WaitingBoardView } from '@/domain/read-models';
import { badRequestResponse, type ApiErrorBody } from '@/lib/http/api-error';
import { clientIpFrom, hitRateLimit, type RateLimitRule } from '@/lib/http/rate-limit';

export const dynamic = 'force-dynamic';

/** Come per i monitor di campata: tetto alto, serve solo a fermare un abuso grossolano. */
const PER_IP: RateLimitRule = { limit: 900, windowMs: PUBLIC_STATUS_RATE_LIMIT.windowMs };

/** Quanti prossimi turni mostrare per impostazione predefinita e al massimo. */
const DEFAULT_NEXT = 4;
const MAX_NEXT = 10;

export interface BoardResponse {
  readonly board: WaitingBoardView;
  readonly serverTime: string;
  readonly timeZone: string;
}

type BoardBody = BoardResponse | ApiErrorBody | SystemHealthUnavailable;

const NO_STORE = { 'cache-control': 'no-store' } as const;

export async function GET(request: NextRequest): Promise<NextResponse<BoardBody>> {
  const raw = request.nextUrl.searchParams.get('prossimi');
  let nextCount = DEFAULT_NEXT;
  if (raw !== null && raw.trim() !== '') {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_NEXT) {
      return badRequestResponse(
        `Parametro \`prossimi\` non valido: atteso un numero fra 0 e ${MAX_NEXT}.`,
      );
    }
    nextCount = parsed;
  }

  const limit = hitRateLimit(`board-ip:${clientIpFrom(request.headers)}`, PER_IP);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST' as const, message: 'Troppe richieste.' } },
      { status: 429, headers: { ...NO_STORE, 'retry-after': String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const container = getContainer();
    const board = await container.queueService.getWaitingBoard(container.clock.today(), nextCount);
    return NextResponse.json(
      { board, serverTime: container.clock.nowIso(), timeZone: container.env.timeZone },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (!isStartupError(error)) {
      throw error;
    }
    console.error(`[public/board] container non disponibile (${error.name}): ${error.message}`);
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL' as const,
          message: 'Servizio momentaneamente non disponibile.',
        },
      },
      { status: 503, headers: NO_STORE },
    );
  }
}
