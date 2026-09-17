// POST /api/v1/admin/workstations/[id]/eject — l'amministratore scollega uno sportello.
//
// Serve al caso più banale dell'officina: fine turno, l'accettatore spegne il monitor e va a casa
// senza uscire dall'applicazione. Il posto resta suo e il collega del turno dopo non può sedersi.
//
// Libera solo l'occupazione della postazione. La pratica eventualmente in carico su quello
// sportello NON viene toccata: un veicolo accettato a metà non si chiude per un problema di
// sessioni, e se è rimasta lì la si sblocca con "Rimetti in coda" nella stessa schermata.
// Idempotente: sganciare un posto già libero risponde 200 senza fare nulla.
import { NextResponse, type NextRequest } from 'next/server';
import { readApiSession } from '@/app/_server/session';
import { getContainer } from '@/config/container';
import { asWorkstationId } from '@/domain/ids';
import { forbiddenResponse, unauthorizedResponse } from '@/lib/http/api-error';
import { canAccess } from '@/lib/navigation';

export const dynamic = 'force-dynamic';

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await readApiSession(request);
  if (session === null) {
    return unauthorizedResponse();
  }
  if (!canAccess('admin', session.role)) {
    return forbiddenResponse("Scollegare uno sportello è riservato all'amministratore.");
  }

  const { id } = await context.params;
  const esito = await getContainer().assistanceService.eject(asWorkstationId(id));
  return NextResponse.json(esito, { headers: { 'cache-control': 'no-store' } });
}
