// /api/v1/system/alerts — le segnalazioni di disfunzione del personale.
//
// POST: chiunque abbia una sessione operatore (accettatore, responsabile, amministratore) può
// segnalare; chi ha segnalato e da dove lo dice la sessione, mai il corpo. GET: l'elenco è
// dell'amministratore, che è chi le gestisce.
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { correlationIdFrom, readApiSession } from '@/app/_server/session';
import { getContainer } from '@/config/container';
import { SYSTEM_ALERT_COMPONENTS } from '@/domain/entities/system-alert';
import {
  badRequestResponse,
  domainErrorResponse,
  forbiddenResponse,
  unauthorizedResponse,
} from '@/lib/http/api-error';
import { canAccess } from '@/lib/navigation';

export const dynamic = 'force-dynamic';

const CreateBody = z.object({
  code: z.string().trim().min(1).max(40),
  component: z.enum(SYSTEM_ALERT_COMPONENTS),
  message: z.string().trim().min(1).max(500),
});

const NO_STORE = { 'cache-control': 'no-store' } as const;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await readApiSession(request);
  if (session === null) {
    return unauthorizedResponse();
  }
  if (!canAccess('admin', session.role)) {
    return forbiddenResponse("Le segnalazioni sono gestite dall'amministratore.");
  }
  const includeResolved = request.nextUrl.searchParams.get('risolte') === '1';
  const service = getContainer().systemAlertService;
  const [alerts, summary] = await Promise.all([service.list(includeResolved), service.summary()]);
  return NextResponse.json({ alerts, summary }, { headers: NO_STORE });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await readApiSession(request);
  if (session === null) {
    return unauthorizedResponse();
  }
  const raw: unknown = await request.json().catch(() => null);
  const parsed = CreateBody.safeParse(raw);
  if (!parsed.success) {
    return badRequestResponse('Segnalazione non valida.', { issues: parsed.error.issues });
  }
  const correlationId = correlationIdFrom(request);
  const esito = await getContainer().systemAlertService.create(
    parsed.data,
    {
      operatorId: session.operatorId,
      displayName: session.displayName,
      workstationId: session.workstationId,
    },
    correlationId,
  );
  if (!esito.ok) {
    return domainErrorResponse(esito.error, { 'x-correlation-id': correlationId });
  }
  return NextResponse.json(
    { alert: esito.value },
    { status: 201, headers: { ...NO_STORE, 'x-correlation-id': correlationId } },
  );
}
