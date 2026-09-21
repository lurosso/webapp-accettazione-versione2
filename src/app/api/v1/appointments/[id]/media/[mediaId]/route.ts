// DELETE /api/v1/appointments/[id]/media/[mediaId] — elimina una foto o un video del check-in.
//
// Serve alla correzione sul momento: una foto sfocata, il veicolo sbagliato, un video partito per
// errore. Vale finché la pratica è in carico, cioè finché il check-in è aperto. Concluso il
// check-in il fascicolo è sigillato e il server risponde 409 qualunque cosa chieda il client: è la
// documentazione con cui si risponde a una contestazione, e non la tocca più l'accettatore.
//
// Il media deve appartenere alla pratica indicata nell'indirizzo: un id di un'altra pratica è 404.
import { NextResponse, type NextRequest } from 'next/server';
import { readApiSession } from '@/app/_server/session';
import { getContainer } from '@/config/container';
import { asAppointmentId } from '@/domain/ids';
import { domainErrorResponse, forbiddenResponse, unauthorizedResponse } from '@/lib/http/api-error';
import { canAccess } from '@/lib/navigation';

export const dynamic = 'force-dynamic';

interface RouteContext {
  readonly params: Promise<{ readonly id: string; readonly mediaId: string }>;
}

export async function DELETE(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await readApiSession(request);
  if (session === null) {
    return unauthorizedResponse();
  }
  if (!canAccess('check-in', session.role)) {
    return forbiddenResponse(
      'Le foto del check-in le elimina chi sta al veicolo: accettatori e amministratore.',
    );
  }
  const { id, mediaId } = await context.params;
  const esito = await getContainer().inspectionService.removeMedia({
    appointmentId: asAppointmentId(id),
    mediaId,
    operatorId: session.operatorId,
  });
  if (!esito.ok) {
    return domainErrorResponse(esito.error);
  }
  return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
}
