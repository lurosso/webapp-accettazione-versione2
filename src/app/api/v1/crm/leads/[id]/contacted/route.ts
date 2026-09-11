// POST /api/v1/crm/leads/[id]/contacted — il BDC dichiara di aver ricontattato il cliente.
// Chiude il lead (stato MANUAL sull'evento in coda di uscita) con chi ha telefonato e l'esito.
// Non dipende dal CRM: se il CRM è irraggiungibile l'evento resta comunque tracciato, ma il
// lavoro del BDC è registrato subito, perché è quello che conta per non richiamare due volte.
import { NextResponse, type NextRequest } from 'next/server';
import { readApiSession } from '@/app/_server/session';
import { getContainer } from '@/config/container';
import { asCrmOutboxEventId } from '@/domain/ids';
import {
  badRequestResponse,
  domainErrorResponse,
  forbiddenResponse,
  unauthorizedResponse,
} from '@/lib/http/api-error';
import { canAccess } from '@/lib/navigation';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const ContactedBody = z.object({
  /** Esito della telefonata, facoltativo: il BDC non deve essere costretto a scrivere. */
  note: z.string().trim().max(500).nullable().optional(),
});

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await readApiSession(request);
  if (session === null) {
    return unauthorizedResponse();
  }
  if (!canAccess('manager', session.role)) {
    return forbiddenResponse('Solo responsabili e amministratori possono chiudere un lead BDC.');
  }

  const raw: unknown = await request.json().catch(() => ({}));
  const parsed = ContactedBody.safeParse(raw ?? {});
  if (!parsed.success) {
    return badRequestResponse('Nota del ricontatto non valida.', { issues: parsed.error.issues });
  }

  const { id } = await context.params;
  const esito = await getContainer().bdcLeadService.markContacted(
    { eventId: asCrmOutboxEventId(id), note: parsed.data.note ?? null },
    { operatorId: session.operatorId },
  );
  if (!esito.ok) {
    return domainErrorResponse(esito.error);
  }
  return NextResponse.json({ lead: esito.value });
}
