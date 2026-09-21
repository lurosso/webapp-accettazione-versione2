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
import { authorizeCronRequest } from '@/app/_server/cron-auth';
import { correlationIdFrom } from '@/app/_server/session';
import { getContainer } from '@/config/container';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const container = getContainer();
  const correlationId = correlationIdFrom(request);
  // Segreto a tempo costante oppure sessione ADMIN, con tetto sui tentativi falliti.
  const autorizzazione = await authorizeCronRequest(request, container.env.cronSecret);
  if (!autorizzazione.ok) {
    return autorizzazione.response;
  }
  const { daCron } = autorizzazione;

  const riepilogo = await container.crmNotifier.drainDue();
  container.logger.info("[CRM][Cron] passata richiesta dall'esterno", { ...riepilogo, daCron });
  return NextResponse.json(riepilogo, { headers: { 'x-correlation-id': correlationId } });
}
