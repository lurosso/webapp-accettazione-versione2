// POST /api/v1/appointments: inserimento manuale di una pratica (cliente senza appuntamento).
// È il fallback dell'officina quando l'agenda Infinity non basta: la pratica nasce nella coda di
// oggi con il prossimo codice. Chiunque lavori in accettazione può farlo.
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { correlationIdFrom, readApiSession } from '@/app/_server/session';
import type { ActionContext } from '@/application/queue/QueueService';
import { getContainer } from '@/config/container';
import {
  badRequestResponse,
  domainErrorResponse,
  forbiddenResponse,
  unauthorizedResponse,
} from '@/lib/http/api-error';
import { canAccess } from '@/lib/navigation';

export const dynamic = 'force-dynamic';

const ManualAppointmentBody = z.object({
  plate: z.string().trim().min(2).max(16),
  customerName: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(32).nullable().optional(),
  brandId: z.string().trim().min(1),
  deskId: z.string().trim().min(1).nullable().optional(),
  serviceDescription: z.string().trim().max(500).nullable().optional(),
  /** Consenso agli avvisi WhatsApp chiesto al banco (predefinito: sì). */
  whatsappOptIn: z.boolean().optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await readApiSession(request);
  if (session === null) {
    return unauthorizedResponse();
  }
  if (!canAccess('accettazione', session.role)) {
    return forbiddenResponse();
  }
  const raw: unknown = await request.json().catch(() => null);
  const parsed = ManualAppointmentBody.safeParse(raw);
  if (!parsed.success) {
    return badRequestResponse('Dati della pratica non validi.', { issues: parsed.error.issues });
  }
  const container = getContainer();
  const correlationId = correlationIdFrom(request);
  const ctx: ActionContext = {
    operatorId: session.operatorId,
    workstationId: session.workstationId,
    correlationId,
  };
  const esito = await container.manualIntakeService.create(
    {
      plate: parsed.data.plate,
      customerName: parsed.data.customerName,
      phone: parsed.data.phone ?? null,
      brandId: parsed.data.brandId,
      deskId: parsed.data.deskId ?? null,
      serviceDescription: parsed.data.serviceDescription ?? null,
      whatsappOptIn: parsed.data.whatsappOptIn ?? true,
    },
    ctx,
  );
  const headers = { 'x-correlation-id': correlationId };
  if (!esito.ok) {
    return domainErrorResponse(esito.error, headers);
  }
  return NextResponse.json({ appointment: esito.value }, { status: 201, headers });
}
