// POST /api/v1/auth/login: verifica credenziali e postazione, imposta il cookie di sessione.
// Limiti di frequenza per indirizzo e per nome utente: una raffica di tentativi sulla rete
// interna viene fermata dopo pochi errori, con l'indicazione di quando riprovare.
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { LOGIN_RATE_LIMIT } from '@/config/constants';
import { getContainer } from '@/config/container';
import { badRequestResponse, domainErrorResponse } from '@/lib/http/api-error';
import { hitPerIp, hitRateLimit } from '@/lib/http/rate-limit';
import { setSessionCookie } from '@/app/_server/session';

function tooManyAttempts(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: 'RATE_LIMITED' as const,
        message: `Troppi tentativi di accesso: riprova fra ${retryAfterSeconds} secondi.`,
      },
    },
    {
      status: 429,
      headers: { 'retry-after': String(retryAfterSeconds), 'cache-control': 'no-store' },
    },
  );
}

export const dynamic = 'force-dynamic';

const LoginBody = z.object({
  username: z.string().trim().min(1, 'Nome utente obbligatorio.').max(64),
  password: z.string().min(1, 'Password obbligatoria.').max(200),
  // Facoltativa: l'amministratore non occupa sportelli. Per l'accettatore la esige il servizio.
  workstationId: z.string().trim().max(64).optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const perIp = hitPerIp('login-ip', request.headers, LOGIN_RATE_LIMIT.perIp);
  if (!perIp.allowed) {
    return tooManyAttempts(perIp.retryAfterSeconds);
  }
  const raw: unknown = await request.json().catch(() => null);
  const parsed = LoginBody.safeParse(raw);
  if (!parsed.success) {
    return badRequestResponse('Dati di login non validi.', { issues: parsed.error.issues });
  }
  // Conta per utente solo i tentativi che arrivano a verificare la password: i più costosi e i
  // soli utili a chi prova a indovinarla.
  const perUser = hitRateLimit(
    `login-user:${parsed.data.username.toLowerCase()}`,
    LOGIN_RATE_LIMIT.perUser,
  );
  if (!perUser.allowed) {
    return tooManyAttempts(perUser.retryAfterSeconds);
  }
  const result = await getContainer().authService.login({
    username: parsed.data.username,
    password: parsed.data.password,
    workstationId: parsed.data.workstationId ?? null,
  });
  if (!result.ok) {
    return domainErrorResponse(result.error);
  }
  const response = NextResponse.json({ session: result.value.session });
  setSessionCookie(response, result.value.token, result.value.session.expiresAt);
  return response;
}
