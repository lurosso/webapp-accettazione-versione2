// GET /api/v1/system/diagnostics — la diagnostica della pagina Sistema: porte esterne, storage
// dei media, sincronizzazione dell'agenda, ognuna con stato, dettaglio e codice da segnalare.
// Riservata all'amministratore (dal 2026-09-24 l'accettatore in Sistema ha solo la segnalazione):
// la rete la misura il browser da solo, intorno a questa stessa chiamata.
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
  if (!canAccess('admin', session.role)) {
    return forbiddenResponse("La diagnostica del sistema è riservata all'amministratore.");
  }
  const container = getContainer();
  const correlationId = correlationIdFrom(request);
  const diagnostica = await container.systemDiagnosticsService.run(correlationId);
  return NextResponse.json(diagnostica, {
    headers: { 'cache-control': 'no-store', 'x-correlation-id': correlationId },
  });
}
