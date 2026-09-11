// GET /api/v1/crm/leads — clienti da ricontattare per il BDC (modulo F).
// Parametri: `giornata=YYYY-MM-DD` (default: oggi) e `gestiti=1` per vedere anche quelli chiusi.
// Riservata a SUPERVISOR e ADMIN: contiene nomi e numeri di telefono di clienti che non si sono
// presentati, dati che non devono girare oltre chi li deve lavorare.
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
  if (!canAccess('manager', session.role)) {
    return forbiddenResponse('Il cruscotto BDC è riservato a responsabili e amministratori.');
  }

  const container = getContainer();
  const { searchParams } = request.nextUrl;
  const giornata = searchParams.get('giornata');
  const tutte = giornata === 'tutte';
  const includeHandled = searchParams.get('gestiti') === '1';

  const view = await container.bdcLeadService.listLeads({
    businessDate: tutte ? null : (giornata ?? container.clock.today()),
    includeHandled,
  });

  return NextResponse.json(
    { ...view, businessDate: tutte ? null : (giornata ?? container.clock.today()) },
    { headers: { 'cache-control': 'no-store' } },
  );
}
