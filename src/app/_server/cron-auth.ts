// Autorizzazione dei tre endpoint cron (rinvii CRM, retention dei media, promemoria), in un posto
// solo: intestazione `x-cron-secret` uguale a `CRON_SECRET`, oppure sessione ADMIN.
//
// Il confronto del segreto è a tempo costante, ma un confronto costante non basta se si può
// provare senza limiti: i tentativi FALLITI vengono contati per indirizzo (o in un contatore
// unico, senza proxy fidato) e oltre il tetto la risposta diventa 429. Un cron legittimo non
// sbaglia il segreto dieci volte in un minuto.
import { NextResponse, type NextRequest } from 'next/server';
import { forbiddenResponse } from '@/lib/http/api-error';
import { clientIpFrom, hitRateLimit } from '@/lib/http/rate-limit';
import { secretsMatch } from '@/lib/http/secrets';
import { canAccess } from '@/lib/navigation';
import { readApiSession } from './session';

const TENTATIVI_FALLITI = { limit: 10, windowMs: 60_000 } as const;

export type CronAuthorization =
  | { readonly ok: true; readonly daCron: boolean }
  | { readonly ok: false; readonly response: NextResponse };

export async function authorizeCronRequest(
  request: NextRequest,
  cronSecret: string | null,
): Promise<CronAuthorization> {
  if (secretsMatch(request.headers.get('x-cron-secret'), cronSecret)) {
    return { ok: true, daCron: true };
  }
  const session = await readApiSession(request);
  if (session !== null && canAccess('admin', session.role)) {
    return { ok: true, daCron: false };
  }
  const limite = hitRateLimit(
    `cron-auth:${clientIpFrom(request.headers) ?? 'globale'}`,
    TENTATIVI_FALLITI,
  );
  if (!limite.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: { code: 'BAD_REQUEST' as const, message: 'Troppi tentativi: riprova più tardi.' },
        },
        { status: 429, headers: { 'retry-after': String(limite.retryAfterSeconds) } },
      ),
    };
  }
  return {
    ok: false,
    response: forbiddenResponse(
      'Richiesta non autorizzata: serve una sessione amministratore oppure `x-cron-secret`.',
    ),
  };
}
