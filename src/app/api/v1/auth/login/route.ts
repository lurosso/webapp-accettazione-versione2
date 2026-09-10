// POST /api/v1/auth/login: verifica credenziali e postazione, imposta il cookie di sessione.
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getContainer } from '@/config/container';
import { badRequestResponse, domainErrorResponse } from '@/lib/http/api-error';
import { setSessionCookie } from '@/app/_server/session';

export const dynamic = 'force-dynamic';

const LoginBody = z.object({
  username: z.string().trim().min(1, 'Nome utente obbligatorio.').max(64),
  password: z.string().min(1, 'Password obbligatoria.').max(200),
  workstationId: z.string().trim().min(1, 'Selezionare la postazione.'),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const raw: unknown = await request.json().catch(() => null);
  const parsed = LoginBody.safeParse(raw);
  if (!parsed.success) {
    return badRequestResponse('Dati di login non validi.', { issues: parsed.error.issues });
  }
  const result = await getContainer().authService.login(parsed.data);
  if (!result.ok) {
    return domainErrorResponse(result.error);
  }
  const response = NextResponse.json({ session: result.value.session });
  setSessionCookie(response, result.value.token, result.value.session.expiresAt);
  return response;
}
