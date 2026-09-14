// GET /api/v1/admin/assistance — accettazioni occupate e pratiche in carico (solo ADMIN).
// Le azioni (rimetti in coda, annulla) passano dalla rotta delle azioni sulla pratica.
import { NextResponse, type NextRequest } from 'next/server';
import { readApiSession } from '@/app/_server/session';
import { getContainer } from '@/config/container';
import { forbiddenResponse, unauthorizedResponse } from '@/lib/http/api-error';
import { canAccess } from '@/lib/navigation';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await readApiSession(request);
  if (session === null) {
    return unauthorizedResponse();
  }
  if (!canAccess('admin', session.role)) {
    return forbiddenResponse('Gli strumenti di assistenza sono riservati agli amministratori.');
  }
  const container = getContainer();
  const view = await container.assistanceService.overview(container.clock.today());
  return NextResponse.json(view, { headers: { 'cache-control': 'no-store' } });
}
