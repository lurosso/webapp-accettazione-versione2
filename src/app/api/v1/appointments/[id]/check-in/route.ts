// POST /api/v1/appointments/[id]/check-in — conclude l'accettazione al veicolo dal tablet.
// Salva le note dell'ispezione, chiude la pratica (la campata si libera) e informa il CRM con
// note e foto raccolte.
import { NextResponse, type NextRequest } from 'next/server';
import { correlationIdFrom, readApiSession } from '@/app/_server/session';
import type { ActionContext } from '@/application/queue/QueueService';
import { getContainer } from '@/config/container';
import { asAppointmentId } from '@/domain/ids';
import {
  badRequestResponse,
  domainErrorResponse,
  unauthorizedResponse,
} from '@/lib/http/api-error';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const CheckInBody = z.object({
  expectedVersion: z.number().int().nonnegative(),
  /** Note e danni rilevati: testo libero, come lo scrive l'accettatore al veicolo. */
  inspectionNotes: z.string().trim().max(2000).nullable().optional(),
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
  const parsed = CheckInBody.safeParse(raw);
  if (!parsed.success) {
    return badRequestResponse('Dati del check-in non validi.', { issues: parsed.error.issues });
  }

  const { id } = await context.params;
  const container = getContainer();
  const correlationId = correlationIdFrom(request);
  const ctx: ActionContext = {
    operatorId: session.operatorId,
    workstationId: session.workstationId,
    correlationId,
  };

  const esito = await container.inspectionService.completeCheckIn(
    {
      appointmentId: asAppointmentId(id),
      expectedVersion: parsed.data.expectedVersion,
      inspectionNotes: parsed.data.inspectionNotes ?? null,
    },
    ctx,
  );
  const headers = { 'x-correlation-id': correlationId };
  if (!esito.ok) {
    return domainErrorResponse(esito.error, headers);
  }
  return NextResponse.json(
    {
      appointment: esito.value.appointment,
      photoCount: esito.value.photoCount,
      crmNotified: esito.value.crmNotified,
    },
    { headers },
  );
}
