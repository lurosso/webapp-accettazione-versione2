// POST /api/v1/auth/logout: libera l'accettazione occupata e cancella il cookie di sessione
// (il JWT scade comunque da solo entro 8 ore). Funziona anche con una password provvisoria.
import { NextResponse, type NextRequest } from 'next/server';
import { clearSessionCookie, readApiSession } from '@/app/_server/session';
import { getContainer } from '@/config/container';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await readApiSession(request, {
    allowPendingPasswordChange: true,
    allowKiosk: true,
  });
  if (session !== null) {
    await getContainer().authService.logout(session);
  }
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}
