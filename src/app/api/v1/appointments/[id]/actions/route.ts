// POST /api/v1/appointments/[id]/actions: Prendi in carico / Salta / Completato / Ripristina e le
// azioni riservate (annulla, rilascia, conferma chiusura d'ufficio). Body
// `{ action, expectedVersion, bayId? }`. 409 su conflitto di versione (con la pratica aggiornata
// in `details.current`), transizione vietata o sportello occupato.
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { correlationIdFrom, readApiSession } from '@/app/_server/session';
import type { ActionContext, TransitionInput } from '@/application/queue/QueueService';
import { getContainer } from '@/config/container';
import { asAppointmentId, asBayId } from '@/domain/ids';
import { ok } from '@/domain/result';
import {
  badRequestResponse,
  domainErrorResponse,
  forbiddenResponse,
  unauthorizedResponse,
} from '@/lib/http/api-error';
import { canAccess } from '@/lib/navigation';

export const dynamic = 'force-dynamic';

const ActionBody = z.object({
  action: z.enum([
    'take',
    'skip',
    'complete',
    'release',
    'restore',
    'reschedule',
    'no-show',
    'cancel',
    'reopen-completed',
    'confirm-auto-close',
    'reactivate',
  ]),
  expectedVersion: z.number().int().nonnegative(),
  bayId: z.string().trim().min(1).nullable().optional(),
  reason: z.string().trim().max(500).nullable().optional(),
});

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await readApiSession(request);
  if (session === null) {
    return unauthorizedResponse();
  }
  // Silos del BDC: la coda è dei banchi (e dell'amministratore che controlla). Il controllo sta
  // anche qui, non solo sulla pagina: una sessione vale per l'API come per il browser.
  if (!canAccess('accettazione', session.role)) {
    return forbiddenResponse(
      "La coda dell'accettazione è riservata agli accettatori e all'amministratore.",
    );
  }

  const raw: unknown = await request.json().catch(() => null);
  const parsed = ActionBody.safeParse(raw);
  if (!parsed.success) {
    return badRequestResponse('Azione non valida.', { issues: parsed.error.issues });
  }
  const { id } = await context.params;
  const container = getContainer();
  const correlationId = correlationIdFrom(request);
  const ctx: ActionContext = {
    operatorId: session.operatorId,
    workstationId: session.workstationId,
    correlationId,
    role: session.role,
  };
  const input: TransitionInput = {
    appointmentId: asAppointmentId(id),
    expectedVersion: parsed.data.expectedVersion,
  };
  const queue = container.queueService;
  const { action } = parsed.data;
  // Annullare una pratica non è un'azione da banco: la decide l'amministratore.
  if (action === 'cancel' && !canAccess('admin', session.role)) {
    return forbiddenResponse(
      "L'annullamento di una pratica è riservato all'amministratore.",
    );
  }
  // Rimettere in coda una pratica presa in carico svuota operatore e sportello: non è più un
  // pulsante da banco (tolto dalla riga il 2026-09-17), la fa l'assistenza in amministrazione.
  if (action === 'release' && !canAccess('admin', session.role)) {
    return forbiddenResponse(
      "Il rilascio di una pratica in carico è riservato all'amministratore (pannello di assistenza).",
    );
  }
  // Confermare una chiusura d'ufficio è dire "il veicolo era stato accettato": lo dice l'amministratore.
  if (action === 'confirm-auto-close' && !canAccess('admin', session.role)) {
    return forbiddenResponse(
      "La conferma di una chiusura d'ufficio è riservata all'amministratore.",
    );
  }

  const result = await (async () => {
    switch (action) {
      case 'take':
        return queue.takeInCharge(
          { ...input, bayId: parsed.data.bayId ? asBayId(parsed.data.bayId) : null },
          ctx,
        );
      case 'skip':
        return queue.skip(input, ctx);
      case 'complete':
        return queue.complete(input, ctx);
      case 'release':
        return queue.release(input, ctx);
      case 'restore':
        return queue.restore(input, ctx);
      case 'reschedule':
        return queue.rescheduleToNow(input, ctx);
      case 'no-show':
        return queue.markNoShow({ ...input, reason: parsed.data.reason ?? undefined }, ctx);
      case 'cancel':
        return queue.cancel(input, ctx);
      case 'reopen-completed':
        return queue.reopenCompleted(input, ctx);
      case 'reactivate':
        return queue.reactivate(input, ctx);
      case 'confirm-auto-close': {
        const esito = await container.inspectionService.confirmAutoClosed(input, ctx);
        return esito.ok ? ok(esito.value.appointment) : esito;
      }
    }
  })();

  const headers = { 'x-correlation-id': correlationId };
  if (!result.ok) {
    return domainErrorResponse(result.error, headers);
  }
  return NextResponse.json({ appointment: result.value }, { headers });
}
