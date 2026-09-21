// POST /api/v1/system/cron/reminders?kind=previous-day|same-day — promemoria ai clienti.
//
// Lo scheduler interno li manda da solo alle ore configurate; questo endpoint esiste per un cron
// esterno (o per una prova controllata dall'amministratore) e passa dallo stesso servizio, quindi
// dallo stesso guardrail: con SPOKI_MODE diverso da live o SPOKI_SAFETY_LOCK attivo nessun
// WhatsApp reale parte, i payload finiscono solo nel registro. Idempotente per pratica e giornata.
//
// Accesso: sessione ADMIN oppure intestazione `x-cron-secret` uguale a `CRON_SECRET`.
import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCronRequest } from '@/app/_server/cron-auth';
import { correlationIdFrom } from '@/app/_server/session';
import { getContainer } from '@/config/container';
import { badRequestResponse } from '@/lib/http/api-error';

export const dynamic = 'force-dynamic';

const KINDS = ['previous-day', 'same-day'] as const;
type CronReminderKind = (typeof KINDS)[number];

function isKind(v: string | null): v is CronReminderKind {
  return v !== null && (KINDS as readonly string[]).includes(v);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const container = getContainer();
  const correlationId = correlationIdFrom(request);
  const autorizzazione = await authorizeCronRequest(request, container.env.cronSecret);
  if (!autorizzazione.ok) {
    return autorizzazione.response;
  }
  const { daCron } = autorizzazione;

  const kind = request.nextUrl.searchParams.get('kind');
  if (!isKind(kind)) {
    return badRequestResponse('Parametro `kind` mancante o non valido: previous-day | same-day.');
  }

  const service = container.appointmentReminderService;
  const riepilogo =
    kind === 'previous-day'
      ? await service.sendPreviousDayReminders(container.clock.today(), correlationId)
      : await service.sendSameDayReminders(container.clock.today(), correlationId);
  container.logger.info("[Promemoria][Cron] passata richiesta dall'esterno", {
    ...riepilogo,
    daCron,
  });
  return NextResponse.json(riepilogo, { headers: { 'x-correlation-id': correlationId } });
}
