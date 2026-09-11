// POST /api/v1/system/cron/crm-retry — svuotamento della coda di uscita verso il CRM.
//
// Esiste perché in produzione i rinvii possono essere affidati a un cron esterno (Utilità di
// pianificazione di Windows, cron di sistema, scheduler del cloud) invece che al temporizzatore
// interno: si spegne quello con `CRM_RETRY_ENABLED=false` e si chiama questo ogni N minuti.
// Le due strade possono anche convivere: ogni evento porta la propria chiave di idempotenza.
//
// Accesso: sessione ADMIN oppure intestazione `x-cron-secret` uguale a `CRON_SECRET`, perché un
// cron di sistema non ha un cookie di sessione. Senza `CRON_SECRET` configurato resta solo la via
// autenticata.
import { NextResponse, type NextRequest } from 'next/server';
import { correlationIdFrom, readApiSession } from '@/app/_server/session';
import { getContainer } from '@/config/container';
import { forbiddenResponse } from '@/lib/http/api-error';
import { canAccess } from '@/lib/navigation';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const container = getContainer();
  const correlationId = correlationIdFrom(request);
  const segreto = container.env.cronSecret;
  const fornito = request.headers.get('x-cron-secret');
  const daCron = segreto !== null && fornito !== null && fornito === segreto;

  if (!daCron) {
    const session = await readApiSession(request);
    if (session === null || !canAccess('admin', session.role)) {
      return forbiddenResponse(
        'Richiesta non autorizzata: serve una sessione amministratore oppure `x-cron-secret`.',
      );
    }
  }

  const riepilogo = await container.crmNotifier.drainDue();
  container.logger.info("[CRM][Cron] passata richiesta dall'esterno", { ...riepilogo, daCron });
  return NextResponse.json(riepilogo, { headers: { 'x-correlation-id': correlationId } });
}
