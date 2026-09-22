// PATCH /api/v1/system/alerts/[id] — l'amministratore porta una segnalazione da nuova a in
// gestione a risolta (o la riapre), con una nota facoltativa su cosa ha fatto.
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { correlationIdFrom, readApiSession } from '@/app/_server/session';
import { getContainer } from '@/config/container';
import { SYSTEM_ALERT_STATUSES } from '@/domain/entities/system-alert';
import { asSystemAlertId } from '@/domain/ids';
import {
  badRequestResponse,
  domainErrorResponse,
  forbiddenResponse,
  unauthorizedResponse,
} from '@/lib/http/api-error';
import { canAccess } from '@/lib/navigation';

export const dynamic = 'force-dynamic';

const PatchBody = z.object({
  status: z.enum(SYSTEM_ALERT_STATUSES),
  note: z.string().trim().max(500).nullable().optional(),
});

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await readApiSession(request);
  if (session === null) {
    return unauthorizedResponse();
  }
  if (!canAccess('admin', session.role)) {
    return forbiddenResponse("Le segnalazioni sono gestite dall'amministratore.");
  }
  const raw: unknown = await request.json().catch(() => null);
  const parsed = PatchBody.safeParse(raw);
  if (!parsed.success) {
    return badRequestResponse('Aggiornamento non valido.', { issues: parsed.error.issues });
  }
  const { id } = await context.params;
  const correlationId = correlationIdFrom(request);
  const esito = await getContainer().systemAlertService.updateStatus(
    asSystemAlertId(id),
    parsed.data.status,
    {
      operatorId: session.operatorId,
      displayName: session.displayName,
      workstationId: session.workstationId,
    },
    correlationId,
    parsed.data.note ?? null,
  );
  if (!esito.ok) {
    return domainErrorResponse(esito.error, { 'x-correlation-id': correlationId });
  }
  return NextResponse.json(
    { alert: esito.value },
    { headers: { 'cache-control': 'no-store', 'x-correlation-id': correlationId } },
  );
}
