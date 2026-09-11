// POST /api/v1/crm/outbox/[id]/retry — "Forza riprova" dal pannello Sistema.
// Rispedisce subito il payload salvato, anche se l'evento era stato abbandonato: chi preme il
// pulsante sa che il CRM è tornato su e non deve aspettare il giro automatico.
import { NextResponse, type NextRequest } from 'next/server';
import { correlationIdFrom, readApiSession } from '@/app/_server/session';
import { getContainer } from '@/config/container';
import { asCrmOutboxEventId } from '@/domain/ids';
import { forbiddenResponse, unauthorizedResponse } from '@/lib/http/api-error';
import { canAccess } from '@/lib/navigation';

export const dynamic = 'force-dynamic';

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await readApiSession(request);
  if (session === null) {
    return unauthorizedResponse();
  }
  if (!canAccess('admin', session.role)) {
    return forbiddenResponse('La riprova manuale è riservata agli amministratori.');
  }

  const { id } = await context.params;
  const correlationId = correlationIdFrom(request);
  const esito = await getContainer().crmOutboxService.retry(asCrmOutboxEventId(id), correlationId);
  if (esito.event === null) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND' as const, message: 'Evento non trovato nella coda.' } },
      { status: 404, headers: { 'x-correlation-id': correlationId } },
    );
  }
  return NextResponse.json(
    { outcome: esito.outcome, event: esito.event },
    { headers: { 'x-correlation-id': correlationId } },
  );
}
