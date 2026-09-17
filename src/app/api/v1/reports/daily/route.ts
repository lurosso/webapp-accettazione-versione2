// GET /api/v1/reports/daily?giornata=YYYY-MM-DD — indicatori della giornata (M7).
// Riservato agli AMMINISTRATORI (dal 2026-09-17): sono numeri sulle persone che lavorano in
// officina, e la visione d'insieme è di chi ha la responsabilità dell'insieme. Il BDC lavora
// sull'elenco degli assenti, non su medie e percentuali.
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
  if (!canAccess('admin', session.role)) {
    return forbiddenResponse("Le statistiche della giornata sono riservate all'amministratore.");
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
