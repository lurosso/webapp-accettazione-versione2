// GET /api/v1/crm/leads — clienti da ricontattare per il BDC (modulo F).
// Parametri: `giornata=YYYY-MM-DD` (default: oggi), `gestiti=1` per vedere anche quelli chiusi e
// `tipo=assenti|anomalie` per uno solo dei due elenchi (default: entrambi).
// Riservata all'amministratore (pannello «Anomalie di oggi»): contiene nomi e numeri di telefono.
// Dal 2026-09-24 il BDC non usa l'app: assenti e anomalie gli arrivano come lead nel suo CRM.
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
  if (!canAccess('admin', session.role)) {
    return forbiddenResponse("L'elenco di assenti e anomalie è riservato all'amministratore.");
  }

  const container = getContainer();
  const { searchParams } = request.nextUrl;
  const giornata = searchParams.get('giornata');
  const tutte = giornata === 'tutte';
  const includeHandled = searchParams.get('gestiti') === '1';
  const tipo = searchParams.get('tipo');

  const view = await container.bdcLeadService.listLeads({
    businessDate: tutte ? null : (giornata ?? container.clock.today()),
    includeHandled,
    ...(tipo === 'anomalie'
      ? { types: ['ANOMALY'] as const }
      : tipo === 'assenti'
        ? { types: ['NO_SHOW'] as const }
        : {}),
  });

  return NextResponse.json(
    { ...view, businessDate: tutte ? null : (giornata ?? container.clock.today()) },
    { headers: { 'cache-control': 'no-store' } },
  );
}
