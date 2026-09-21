// POST /api/v1/system/cron/media-retention — elimina i file delle foto scadute (retention).
// Gemello di cron/crm-retry: il lavoro lo fa già lo scheduler della giornata dopo il fine turno,
// ma un cron esterno può chiamare questo endpoint quando il processo dell'app non è quello che
// deve occuparsene. Accesso con sessione ADMIN oppure intestazione `x-cron-secret`.
import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCronRequest } from '@/app/_server/cron-auth';
import { correlationIdFrom } from '@/app/_server/session';
import { getContainer } from '@/config/container';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const container = getContainer();
  const correlationId = correlationIdFrom(request);
  const autorizzazione = await authorizeCronRequest(request, container.env.cronSecret);
  if (!autorizzazione.ok) {
    return autorizzazione.response;
  }
  const riepilogo = await container.inspectionArchiveService.purgeExpired();
  return NextResponse.json(riepilogo, { headers: { 'x-correlation-id': correlationId } });
}
