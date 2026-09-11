// GET /api/v1/crm/outbox — coda di uscita verso il CRM, vista tecnica (modulo F).
// Parametri: `stato=PENDING,FAILED` (elenco separato da virgole) e `limite=`.
// Riservata agli ADMIN: è la pagina di chi tiene in piedi il sistema, non contiene dati dei
// clienti ma espone messaggi d'errore e chiavi tecniche.
import { NextResponse, type NextRequest } from 'next/server';
import { readApiSession } from '@/app/_server/session';
import type { CrmOutboxStatus } from '@/domain/entities/crm-outbox-event';
import { getContainer } from '@/config/container';
import { forbiddenResponse, unauthorizedResponse } from '@/lib/http/api-error';
import { canAccess } from '@/lib/navigation';

export const dynamic = 'force-dynamic';

const STATI: readonly CrmOutboxStatus[] = ['PENDING', 'SENT', 'FAILED', 'MANUAL'];

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await readApiSession(request);
  if (session === null) {
    return unauthorizedResponse();
  }
  if (!canAccess('admin', session.role)) {
    return forbiddenResponse('La coda di uscita verso il CRM è riservata agli amministratori.');
  }

  const { searchParams } = request.nextUrl;
  const richiesti = (searchParams.get('stato') ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is CrmOutboxStatus => STATI.includes(s as CrmOutboxStatus));
  const limite = Number.parseInt(searchParams.get('limite') ?? '', 10);

  const view = await getContainer().crmOutboxService.list({
    statuses: richiesti,
    ...(Number.isFinite(limite) && limite > 0 ? { limit: limite } : {}),
  });
  return NextResponse.json(view, { headers: { 'cache-control': 'no-store' } });
}
