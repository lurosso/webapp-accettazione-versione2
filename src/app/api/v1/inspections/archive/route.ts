// GET /api/v1/inspections/archive?q= — storico dei check-in fotografici (area operatore).
// Ricerca per targa o codice pratica; vuota = gli ultimi cinquanta. Accessibile a chi lavora in
// accettazione: è il fascicolo che serve quando un cliente contesta un danno al ritiro.
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
  if (!canAccess('accettazione', session.role)) {
    return forbiddenResponse("L'archivio delle ispezioni è riservato agli operatori.");
  }
  const q = (request.nextUrl.searchParams.get('q') ?? '').slice(0, 40);
  const entries = await getContainer().inspectionArchiveService.search(q, 50);
  return NextResponse.json({ query: q, entries }, { headers: { 'cache-control': 'no-store' } });
}
