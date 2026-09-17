// POST /api/v1/crm/leads/[id]/reopen — il BDC riporta un lead chiuso fra quelli da fare.
//
// Serve dopo un tocco sbagliato (l'elenco si scorre con il telefono in mano) o dopo una
// riprogrammazione che poi salta. Il lead torna nella lista delle chiamate da fare e lo stato
// tecnico della consegna al CRM ridiventa quello di prima: nessun rinvio automatico riparte,
// perché il CRM l'evento l'ha già ricevuto o non lo riceverà comunque.
//
// Idempotente: un lead che non era chiuso torna com'è, senza errori.
import { NextResponse, type NextRequest } from 'next/server';
import { readApiSession } from '@/app/_server/session';
import { getContainer } from '@/config/container';
import { domainErrorResponse, forbiddenResponse, unauthorizedResponse } from '@/lib/http/api-error';
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
  if (!canAccess('manager', session.role)) {
    return forbiddenResponse('Solo responsabili e amministratori possono riaprire un lead BDC.');
  }

  const { id } = await context.params;
  const esito = await getContainer().bdcLeadService.reopenLead(id, {
    operatorId: session.operatorId,
  });
  if (!esito.ok) {
    return domainErrorResponse(esito.error);
  }
  return NextResponse.json({ lead: esito.value });
}
