// GET /api/v1/reports/daily?giornata=YYYY-MM-DD — indicatori della giornata (M7).
// Riservato a responsabili e amministratori: sono numeri sulle persone che lavorano in officina,
// non un dato operativo da lasciare aperto.
import { NextResponse, type NextRequest } from 'next/server';
import { readApiSession } from '@/app/_server/session';
import { getContainer } from '@/config/container';
import { isIsoDate, isoDate } from '@/domain/value-objects/iso-date';
import { badRequestResponse, forbiddenResponse, unauthorizedResponse } from '@/lib/http/api-error';
import { canAccess } from '@/lib/navigation';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await readApiSession(request);
  if (session === null) {
    return unauthorizedResponse();
  }
  if (!canAccess('manager', session.role)) {
    return forbiddenResponse('Le statistiche sono riservate a responsabili e amministratori.');
  }

  const container = getContainer();
  const richiesta = request.nextUrl.searchParams.get('giornata');
  if (richiesta !== null && !isIsoDate(richiesta)) {
    return badRequestResponse('Giornata non valida: atteso YYYY-MM-DD.');
  }
  const businessDate = richiesta === null ? container.clock.today() : isoDate(richiesta);

  const report = await container.dailyReportService.getDailyReport(businessDate);
  return NextResponse.json(report, { headers: { 'cache-control': 'no-store' } });
}
