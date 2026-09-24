// Proxy Next.js 16 (ex middleware). Fa tre cose, su ogni richiesta che non sia un file statico:
//
// 1. INTESTAZIONI DI SICUREZZA con nonce: genera un nonce per la richiesta, costruisce la
//    Content-Security-Policy e la mette sia sulla richiesta (Next la legge per mettere il nonce sui
//    propri script) sia sulla risposta. Vale per tutte le pagine, pubbliche e private: la CSP è la
//    difesa di fondo contro l'XSS, e il portale cliente è la parte più esposta.
// 2. DIFESA CSRF sulle API che cambiano stato: una richiesta POST/PATCH/DELETE che il browser
//    dichiara cross-site, o la cui Origin non è il nostro host, viene rifiutata prima ancora di
//    guardare la sessione. Il cookie SameSite=Lax fa già la sua parte; questo è il secondo lucchetto.
// 3. SESSIONE per area operatore e API: controllo leggero (firma e scadenza del JWT) senza
//    container; la riverifica dell'operatore avviene nei Route Handler e nei Server Component
//    tramite `app/_server/session.ts`. Una sessione con password provvisoria (claim
//    `mustChangePassword`) può raggiungere solo la pagina di cambio e le rotte di autenticazione.
import { NextResponse, type NextRequest } from 'next/server';
import { verifySessionToken } from '@/application/auth/session-token';
import { resolveSessionSecret, SESSION_COOKIE_NAME } from '@/config/auth';
import { parseEnv } from '@/config/env';
import { acceptedCorrelationId } from '@/lib/http/correlation-id';
import { crossSiteRequestReason } from '@/lib/http/same-origin';
import {
  buildContentSecurityPolicy,
  generateNonce,
  STRICT_TRANSPORT_SECURITY,
} from '@/lib/http/security-headers';

/** Rotte API raggiungibili senza sessione. */
const PUBLIC_API_PREFIXES = [
  '/api/v1/auth/',
  '/api/v1/health',
  '/api/v1/public/',
  '/api/v1/webhooks/',
];

/** Pagine che richiedono una sessione (le altre — login, portale cliente, display — sono aperte). */
const PROTECTED_PAGE_PREFIXES = [
  '/accettazione',
  '/tablet',
  '/check-in',
  '/sistema',
  '/admin',
  '/comunicazioni',
  '/cambia-password',
];

function isPublicApi(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isProtectedPage(pathname: string): boolean {
  return PROTECTED_PAGE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Pagina del cambio password: l'unica consentita finché la provvisoria non è stata sostituita. */
export const CHANGE_PASSWORD_PATH = '/cambia-password';

let cachedSecret: string | null = null;
function sessionSecret(): string {
  if (cachedSecret === null) {
    cachedSecret = resolveSessionSecret(parseEnv());
  }
  return cachedSecret;
}

const IS_DEV = process.env.NODE_ENV === 'development';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith('/api/');

  const nonce = generateNonce();
  const csp = buildContentSecurityPolicy({ nonce, dev: IS_DEV });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);
  // Propaga il correlation id (o ne crea uno) verso i Route Handler. Un valore fuori forma — a-capo,
  // decine di KB — non viene copiato: si riparte da uno nuovo.
  if (acceptedCorrelationId(requestHeaders.get('x-correlation-id')) === null) {
    requestHeaders.set('x-correlation-id', globalThis.crypto.randomUUID());
  }

  const conIntestazioni = (response: NextResponse): NextResponse => {
    response.headers.set('content-security-policy', csp);
    if (IS_PRODUCTION) {
      response.headers.set('strict-transport-security', STRICT_TRANSPORT_SECURITY);
    }
    return response;
  };
  const prosegui = (): NextResponse =>
    conIntestazioni(NextResponse.next({ request: { headers: requestHeaders } }));

  // Difesa CSRF: vale per ogni API tranne i webhook (chiamate server-to-server, senza browser).
  if (isApi && !pathname.startsWith('/api/v1/webhooks/')) {
    const motivo = crossSiteRequestReason(request.method, request.headers);
    if (motivo !== null) {
      return conIntestazioni(
        NextResponse.json(
          {
            error: {
              code: 'FORBIDDEN',
              message: 'Richiesta rifiutata: origine non consentita.',
              details: { motivo },
            },
          },
          { status: 403 },
        ),
      );
    }
  }

  if (isApi && isPublicApi(pathname)) {
    return prosegui();
  }
  if (!isApi && !isProtectedPage(pathname)) {
    return prosegui();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const verified =
    token === undefined || token === '' ? null : await verifySessionToken(token, sessionSecret());

  if (verified === null || !verified.ok) {
    if (isApi) {
      return conIntestazioni(
        NextResponse.json(
          {
            error: {
              code: 'UNAUTHORIZED',
              message: 'Sessione assente o scaduta: effettuare il login.',
            },
          },
          { status: 401 },
        ),
      );
    }
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', `${pathname}${request.nextUrl.search}`);
    const response = NextResponse.redirect(loginUrl);
    if (token !== undefined) {
      response.cookies.delete(SESSION_COOKIE_NAME);
    }
    return conIntestazioni(response);
  }

  if (verified.value.mustChangePassword && !pathname.startsWith(CHANGE_PASSWORD_PATH)) {
    if (isApi) {
      return conIntestazioni(
        NextResponse.json(
          {
            error: {
              code: 'PASSWORD_CHANGE_REQUIRED',
              message: 'Password provvisoria: va sostituita prima di continuare.',
            },
          },
          { status: 403 },
        ),
      );
    }
    const changeUrl = new URL(CHANGE_PASSWORD_PATH, request.url);
    changeUrl.searchParams.set('next', `${pathname}${request.nextUrl.search}`);
    return conIntestazioni(NextResponse.redirect(changeUrl));
  }

  return prosegui();
}

export const config = {
  // Tutto tranne i file statici di Next e le icone in `public/`: la CSP deve accompagnare ogni
  // pagina, e le API hanno bisogno del controllo di origine e di sessione.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon-192.png|icon-512.png|apple-touch-icon.png|icona-checkin.svg).*)',
  ],
};
