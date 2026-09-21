// GET /api/v1/inspections/archive — l'archivio delle ispezioni, in due modi.
//
// `?date=YYYY-MM-DD` (predefinito: la giornata di oggi): tutte le pratiche di quel giorno, con o
// senza foto — è quello che si apre al ritiro, per vedere com'era il veicolo all'arrivo. `?q=`:
// la storia di una targa o di un codice su tutte le giornate, che è quello che serve quando arriva
// una contestazione settimane dopo. Con `q` la data non conta.
import { NextResponse, type NextRequest } from 'next/server';
import { readApiSession } from '@/app/_server/session';
import { getContainer } from '@/config/container';
import type { IsoDate } from '@/domain/value-objects/iso-date';
import { badRequestResponse, forbiddenResponse, unauthorizedResponse } from '@/lib/http/api-error';
import { canAccess } from '@/lib/navigation';

export const dynamic = 'force-dynamic';

const GIORNO = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await readApiSession(request);
  if (session === null) {
    return unauthorizedResponse();
  }
  if (!canAccess('accettazione', session.role)) {
    return forbiddenResponse("L'archivio delle ispezioni è riservato agli operatori.");
  }
  const container = getContainer();
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 40);
  const dateParam = request.nextUrl.searchParams.get('date');
  if (dateParam !== null && !GIORNO.test(dateParam)) {
    return badRequestResponse('Data non valida: usare il formato YYYY-MM-DD.', { date: dateParam });
  }
  const date = (dateParam ?? container.clock.today()) as IsoDate;
  const entries =
    q !== ''
      ? await container.inspectionArchiveService.search(q, 50)
      : await container.inspectionArchiveService.listByDay(date);
  return NextResponse.json(
    { query: q, date: q !== '' ? null : date, entries },
    { headers: { 'cache-control': 'no-store' } },
  );
}
