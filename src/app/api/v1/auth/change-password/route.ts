// POST /api/v1/auth/change-password: l'operatore sostituisce la propria password (provvisoria o
// no) e riceve un nuovo cookie di sessione senza l'obbligo di cambio. È l'unica rotta, oltre a
// /auth/me e /auth/logout, raggiungibile con una password provvisoria.
// Verifica la password attuale, quindi ha lo stesso limite di frequenza per utente del login: un
// collega che conosce il nome utente non deve poterla indovinare a raffica.
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { readApiSession, setSessionCookie } from '@/app/_server/session';
import { LOGIN_RATE_LIMIT } from '@/config/constants';
import { getContainer } from '@/config/container';
import {
  badRequestResponse,
  domainErrorResponse,
  unauthorizedResponse,
} from '@/lib/http/api-error';
import { hitRateLimit } from '@/lib/http/rate-limit';

export const dynamic = 'force-dynamic';

const ChangePasswordBody = z.object({
  currentPassword: z.string().min(1, 'Password attuale obbligatoria.').max(200),
  newPassword: z.string().min(1, 'Nuova password obbligatoria.').max(200),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await readApiSession(request, {
    allowKiosk: true,
    allowPendingPasswordChange: true,
  });
  if (session === null) {
    return unauthorizedResponse();
  }
  const limite = hitRateLimit(`password-change:${session.operatorId}`, LOGIN_RATE_LIMIT.perUser);
  if (!limite.allowed) {
    return NextResponse.json(
      {
        error: {
          code: 'RATE_LIMITED' as const,
          message: `Troppi tentativi: riprova fra ${limite.retryAfterSeconds} secondi.`,
        },
      },
      {
        status: 429,
        headers: { 'retry-after': String(limite.retryAfterSeconds), 'cache-control': 'no-store' },
      },
    );
  }
  const raw: unknown = await request.json().catch(() => null);
  const parsed = ChangePasswordBody.safeParse(raw);
  if (!parsed.success) {
    return badRequestResponse('Dati non validi.', { issues: parsed.error.issues });
  }
  const result = await getContainer().authService.changePassword(session, parsed.data);
  if (!result.ok) {
    return domainErrorResponse(result.error);
  }
  const response = NextResponse.json({ session: result.value.session });
  setSessionCookie(response, result.value.token, result.value.session.expiresAt);
  return response;
}
