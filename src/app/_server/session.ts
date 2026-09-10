// Helper lato server (Server Component e Route Handler) per leggere la sessione dal cookie.
// Cartella privata `_server`: non genera rotte. È l'unico ponte fra cookie e IAuthService.
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { NextRequest, NextResponse } from 'next/server';
import type { Session } from '@/application/auth/IAuthService';
import { SESSION_COOKIE_NAME } from '@/config/auth';
import { getContainer } from '@/config/container';

/** Sessione corrente dai cookie della richiesta (Server Component), null se assente o non valida. */
export async function readSession(): Promise<Session | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (token === undefined || token === '') {
    return null;
  }
  const verified = await getContainer().authService.verify(token);
  return verified.ok ? verified.value : null;
}

/** Per le pagine protette: sessione valida oppure redirect al login con ritorno. */
export async function requireSession(nextPath: string): Promise<Session> {
  const session = await readSession();
  if (session === null) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }
  return session;
}

/** Per i Route Handler: sessione dal cookie della `NextRequest`, null se assente o non valida. */
export async function readApiSession(request: NextRequest): Promise<Session | null> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (token === undefined || token === '') {
    return null;
  }
  const verified = await getContainer().authService.verify(token);
  return verified.ok ? verified.value : null;
}

/** Imposta il cookie di sessione sulla risposta (HttpOnly, SameSite=Lax, Secure in produzione). */
export function setSessionCookie(response: NextResponse, token: string, expiresAt: string): void {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: getContainer().env.nodeEnv === 'production',
    path: '/',
    expires: new Date(expiresAt),
  });
}

/** Cancella il cookie di sessione. */
export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

/** Correlation id della richiesta: riusa l'header in ingresso oppure ne genera uno. */
export function correlationIdFrom(request: NextRequest): string {
  return request.headers.get('x-correlation-id') ?? getContainer().ids.next();
}
