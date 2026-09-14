// POST /api/v1/admin/operators/[id]/reset-password — password provvisoria (solo ADMIN).
// La password è restituita UNA volta in questa risposta: da qui in avanti esiste solo il suo hash.
import { NextResponse, type NextRequest } from 'next/server';
import { readApiSession } from '@/app/_server/session';
import { getContainer } from '@/config/container';
import { asOperatorId } from '@/domain/ids';
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
  if (!canAccess('admin', session.role)) {
    return forbiddenResponse('Solo un amministratore può azzerare una password.');
  }
  const { id } = await context.params;
  const esito = await getContainer().operatorAdminService.resetPassword(asOperatorId(id), {
    operatorId: session.operatorId,
  });
  if (!esito.ok) {
    return domainErrorResponse(esito.error);
  }
  return NextResponse.json(esito.value, { headers: { 'cache-control': 'no-store' } });
}
