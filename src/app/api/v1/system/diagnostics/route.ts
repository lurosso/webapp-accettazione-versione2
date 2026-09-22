// GET /api/v1/system/diagnostics — la diagnostica della pagina Sistema: porte esterne, storage
// dei media, sincronizzazione dell'agenda, ognuna con stato, dettaglio e codice da segnalare.
// Riservata a chi lavora nell'area Sistema (accettatori e amministratore): la rete la misura il
// browser da solo, intorno a questa stessa chiamata.
import { NextResponse, type NextRequest } from 'next/server';
import { correlationIdFrom, readApiSession } from '@/app/_server/session';
import { getContainer } from '@/config/container';
import { forbiddenResponse, unauthorizedResponse } from '@/lib/http/api-error';
import { canAccess } from '@/lib/navigation';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await readApiSession(request);
  if (session === null) {
    return unauthorizedResponse();
  }
  if (!canAccess('sistema', session.role) && !canAccess('manager', session.role)) {
    return forbiddenResponse('La diagnostica è riservata al personale di accettazione.');
  }
  const container = getContainer();
  const correlationId = correlationIdFrom(request);
  const diagnostica = await container.systemDiagnosticsService.run(correlationId);
  return NextResponse.json(diagnostica, {
    headers: { 'cache-control': 'no-store', 'x-correlation-id': correlationId },
  });
}
