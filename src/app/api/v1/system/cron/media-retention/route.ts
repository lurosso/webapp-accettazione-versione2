// POST /api/v1/system/cron/media-retention — elimina i file delle foto scadute (retention).
// Gemello di cron/crm-retry: il lavoro lo fa già lo scheduler della giornata dopo il fine turno,
// ma un cron esterno può chiamare questo endpoint quando il processo dell'app non è quello che
// deve occuparsene. Accesso con sessione ADMIN oppure intestazione `x-cron-secret`.
import { NextResponse, type NextRequest } from 'next/server';
import { correlationIdFrom, readApiSession } from '@/app/_server/session';
import { getContainer } from '@/config/container';
import { forbiddenResponse } from '@/lib/http/api-error';
import { secretsMatch } from '@/lib/http/secrets';
import { canAccess } from '@/lib/navigation';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const container = getContainer();
  const correlationId = correlationIdFrom(request);
  const daCron = secretsMatch(request.headers.get('x-cron-secret'), container.env.cronSecret);
  if (!daCron) {
    const session = await readApiSession(request);
    if (session === null || !canAccess('admin', session.role)) {
      return forbiddenResponse(
        'Richiesta non autorizzata: serve una sessione amministratore oppure `x-cron-secret`.',
      );
    }
  }
  const riepilogo = await container.inspectionArchiveService.purgeExpired();
  return NextResponse.json(riepilogo, { headers: { 'x-correlation-id': correlationId } });
}
