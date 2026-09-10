// POST /api/v1/appointments/[id]/actions: Prendi in carico / Salta / Completato / Rilascia /
// Ripristina. Body `{ action, expectedVersion, bayId? }`. 409 su conflitto di versione (con la
// pratica aggiornata in `details.current`), transizione vietata o campata occupata.
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { correlationIdFrom, readApiSession } from '@/app/_server/session';
import type { ActionContext, TransitionInput } from '@/application/queue/QueueService';
import { getContainer } from '@/config/container';
import { asAppointmentId, asBayId } from '@/domain/ids';
import {
  badRequestResponse,
  domainErrorResponse,
  unauthorizedResponse,
} from '@/lib/http/api-error';

export const dynamic = 'force-dynamic';

const ActionBody = z.object({
  action: z.enum(['take', 'skip', 'complete', 'release', 'restore']),
  expectedVersion: z.number().int().nonnegative(),
  bayId: z.string().trim().min(1).nullable().optional(),
});

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await readApiSession(request);
  if (session === null) {
    return unauthorizedResponse();
  }
  const raw: unknown = await request.json().catch(() => null);
  const parsed = ActionBody.safeParse(raw);
  if (!parsed.success) {
    return badRequestResponse('Azione non valida.', { issues: parsed.error.issues });
  }
  const { id } = await context.params;
  const container = getContainer();
  const correlationId = correlationIdFrom(request);
  const ctx: ActionContext = {
    operatorId: session.operatorId,
    workstationId: session.workstationId,
    correlationId,
  };
  const input: TransitionInput = {
    appointmentId: asAppointmentId(id),
    expectedVersion: parsed.data.expectedVersion,
  };
  const queue = container.queueService;
  const { action } = parsed.data;

  const result = await (async () => {
    switch (action) {
      case 'take':
        return queue.takeInCharge(
          { ...input, bayId: parsed.data.bayId ? asBayId(parsed.data.bayId) : null },
          ctx,
        );
      case 'skip':
        return queue.skip(input, ctx);
      case 'complete':
        return queue.complete(input, ctx);
      case 'release':
        return queue.release(input, ctx);
      case 'restore':
        return queue.restore(input, ctx);
    }
  })();

  const headers = { 'x-correlation-id': correlationId };
  if (!result.ok) {
    return domainErrorResponse(result.error, headers);
  }
  return NextResponse.json({ appointment: result.value }, { headers });
}
