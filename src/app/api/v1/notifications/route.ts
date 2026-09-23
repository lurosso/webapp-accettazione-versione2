// GET /api/v1/notifications — la schermata Comunicazioni: i messaggi al cliente non arrivati.
// Di default quelli ancora da gestire (in riprova automatica, da contattare a mano, senza numero);
// con `vista=gestite` quelli chiusi a mano con l'esito. Ultimi giorni soltanto: una segnalazione
// di un mese fa non è più un cliente da avvisare.
// Aperta a banco, BDC e amministratore: contiene nomi e numeri, ma sono quelli che vanno chiamati.
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
  if (!canAccess('comunicazioni', session.role)) {
    return forbiddenResponse('La schermata Comunicazioni è riservata agli operatori.');
  }

  const vista = request.nextUrl.searchParams.get('vista') === 'gestite' ? 'handled' : 'open';
  const view = await getContainer().communicationsService.list(vista, {
    operatorId: session.operatorId,
  });
  return NextResponse.json(view, { headers: { 'cache-control': 'no-store' } });
}
