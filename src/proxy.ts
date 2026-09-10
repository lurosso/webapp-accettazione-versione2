// Proxy Next.js 16 (ex middleware): protegge area operatore e API verificando il JWT del cookie.
// Controllo leggero (firma e scadenza) senza container; la riverifica dell'operatore avviene nei
// Route Handler e nei Server Component tramite `app/_server/session.ts`.
import { NextResponse, type NextRequest } from 'next/server';
import { verifySessionToken } from '@/application/auth/session-token';
import { resolveSessionSecret, SESSION_COOKIE_NAME } from '@/config/auth';
import { parseEnv } from '@/config/env';

/** Rotte API raggiungibili senza sessione. */
const PUBLIC_API_PREFIXES = [
  '/api/v1/auth/',
  '/api/v1/health',
  '/api/v1/public/',
  '/api/v1/webhooks/',
];

function isPublicApi(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

let cachedSecret: string | null = null;
function sessionSecret(): string {
  if (cachedSecret === null) {
    cachedSecret = resolveSessionSecret(parseEnv());
  }
  return cachedSecret;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith('/api/');
  if (isApi && isPublicApi(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const verified =
    token === undefined || token === '' ? null : await verifySessionToken(token, sessionSecret());

  if (verified === null || !verified.ok) {
    if (isApi) {
      return NextResponse.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Sessione assente o scaduta: effettuare il login.',
          },
        },
        { status: 401 },
      );
    }
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', `${pathname}${request.nextUrl.search}`);
    const response = NextResponse.redirect(loginUrl);
    if (token !== undefined) {
      response.cookies.delete(SESSION_COOKIE_NAME);
    }
    return response;
  }

  // Propaga il correlation id (o ne crea uno) verso i Route Handler.
  const headers = new Headers(request.headers);
  if (!headers.has('x-correlation-id')) {
    headers.set('x-correlation-id', globalThis.crypto.randomUUID());
  }
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/accettazione/:path*', '/sistema/:path*', '/api/v1/:path*'],
};
