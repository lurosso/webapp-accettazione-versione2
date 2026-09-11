// GET /api/v1/reports/daily/csv?giornata=YYYY-MM-DD — riepilogo dettagliato della giornata.
//
// Risponde con un file da scaricare, non con JSON: chi lo chiede vuole aprirlo in Excel e
// riordinarlo a modo suo. Il BOM iniziale serve proprio a questo — senza, Excel su Windows legge
// gli accenti come caratteri strani e il file sembra rotto.
import { type NextRequest } from 'next/server';
import { readApiSession } from '@/app/_server/session';
import { getContainer } from '@/config/container';
import { isIsoDate, isoDate } from '@/domain/value-objects/iso-date';
import { badRequestResponse, forbiddenResponse, unauthorizedResponse } from '@/lib/http/api-error';
import { canAccess } from '@/lib/navigation';

export const dynamic = 'force-dynamic';

const BOM = '\uFEFF';

export async function GET(request: NextRequest): Promise<Response> {
  const session = await readApiSession(request);
  if (session === null) {
    return unauthorizedResponse();
  }
  if (!canAccess('manager', session.role)) {
    return forbiddenResponse('Il report è riservato a responsabili e amministratori.');
  }

  const container = getContainer();
  const richiesta = request.nextUrl.searchParams.get('giornata');
  if (richiesta !== null && !isIsoDate(richiesta)) {
    return badRequestResponse('Giornata non valida: atteso YYYY-MM-DD.');
  }
  const businessDate = richiesta === null ? container.clock.today() : isoDate(richiesta);

  const csv = await container.dailyReportService.buildDailyCsv(businessDate);
  const nome = container.dailyReportService.csvFileName(businessDate);
  return new Response(BOM + csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${nome}"`,
      'cache-control': 'no-store',
    },
  });
}
