// POST /api/v1/system/close-day — chiusura della giornata operativa.
// A officina chiusa non deve restare nulla di aperto: chi era ancora in coda diventa assente
// (lead per il BDC, con evento al CRM), chi era ancora in carico viene annullato. Monitor e
// tabellone si svuotano da soli, perché le loro viste derivano dalle pratiche aperte.
//
// Riservata a SUPERVISOR e ADMIN: è l'azione più distruttiva dell'applicazione.
import { NextResponse, type NextRequest } from 'next/server';
import { correlationIdFrom, readApiSession } from '@/app/_server/session';
import type { ActionContext } from '@/application/queue/QueueService';
import { getContainer } from '@/config/container';
import { isoDate } from '@/domain/value-objects/iso-date';
import {
  badRequestResponse,
  domainErrorResponse,
  forbiddenResponse,
  unauthorizedResponse,
} from '@/lib/http/api-error';
import { canAccess } from '@/lib/navigation';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const CloseDayBody = z.object({
  /** Giornata da chiudere; assente = quella corrente dell'officina. */
  businessDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato atteso YYYY-MM-DD')
    .optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await readApiSession(request);
  if (session === null) {
    return unauthorizedResponse();
  }
  if (!canAccess('manager', session.role)) {
    return forbiddenResponse(
      'La chiusura della giornata è riservata a responsabili e amministratori.',
    );
  }

  const raw: unknown = await request.json().catch(() => ({}));
  const parsed = CloseDayBody.safeParse(raw ?? {});
  if (!parsed.success) {
    return badRequestResponse('Giornata non valida.', { issues: parsed.error.issues });
  }

  const container = getContainer();
  const correlationId = correlationIdFrom(request);
  const ctx: ActionContext = {
    operatorId: session.operatorId,
    workstationId: session.workstationId,
    correlationId,
  };
  const businessDate =
    parsed.data.businessDate === undefined
      ? container.clock.today()
      : isoDate(parsed.data.businessDate);

  const esito = await container.queueService.closeBusinessDay(businessDate, ctx);
  if (!esito.ok) {
    return domainErrorResponse(esito.error, { 'x-correlation-id': correlationId });
  }
  return NextResponse.json(esito.value, { headers: { 'x-correlation-id': correlationId } });
}
