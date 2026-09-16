// POST /api/v1/auth/quick-login: accesso veloce di SVILUPPO (DEV_QUICK_LOGIN). Body `{ profile }`
// con uno dei profili proposti dalla pagina di login (admin, bdc, accettatore-s1…): emette la
// sessione di un account `dev.*` senza credenziali e imposta il cookie. Quando il servizio non è
// costruito (produzione, oppure DEV_QUICK_LOGIN=false) la rotta risponde 404: non esiste.
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getContainer } from '@/config/container';
import { badRequestResponse, domainErrorResponse } from '@/lib/http/api-error';
import { setSessionCookie } from '@/app/_server/session';

export const dynamic = 'force-dynamic';

const Body = z.object({ profile: z.string().trim().min(1).max(64) });

export async function POST(request: NextRequest): Promise<NextResponse> {
  const quick = getContainer().devQuickLogin;
  if (quick === null) {
    return NextResponse.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: "L'accesso veloce non è disponibile in questo ambiente.",
        },
      },
      { status: 404, headers: { 'cache-control': 'no-store' } },
    );
  }
  const raw: unknown = await request.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return badRequestResponse('Profilo non valido.', { issues: parsed.error.issues });
  }
  const result = await quick.login(parsed.data.profile);
  if (!result.ok) {
    return domainErrorResponse(result.error);
  }
  const response = NextResponse.json({ session: result.value.session });
  setSessionCookie(response, result.value.token, result.value.session.expiresAt);
  return response;
}
