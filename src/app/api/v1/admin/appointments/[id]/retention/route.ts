// PATCH /api/v1/admin/appointments/[id]/retention — conservazione dei media di una pratica.
//
// Due interruttori, indipendenti, riservati all'amministratore:
// - `legalHold` (con `legalHoldReason`): vincolo legale. Finché c'è, foto e video non scadono per
//   nessuna regola: contenzioso, contestazione, richiesta dell'assicurazione.
// - `orderClosed`: la commessa in Infinity è definitivamente chiusa (veicolo consegnato). Finché
//   non lo è, i media non scadono qualunque età abbiano — un'auto ferma mesi per un ricambio ha
//   ancora bisogno del suo video di check-in. Oggi lo dichiara l'amministratore; quando la
//   lettura da Infinity sarà collegata lo farà la sincronizzazione.
//
// Il corpo deve cambiare almeno una delle due cose: una richiesta vuota è un errore, non un no-op
// silenzioso.
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { readApiSession } from '@/app/_server/session';
import { getContainer } from '@/config/container';
import { asAppointmentId } from '@/domain/ids';
import {
  badRequestResponse,
  domainErrorResponse,
  forbiddenResponse,
  unauthorizedResponse,
} from '@/lib/http/api-error';
import { canAccess } from '@/lib/navigation';

export const dynamic = 'force-dynamic';

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

const Body = z
  .object({
    legalHold: z.boolean().optional(),
    legalHoldReason: z.string().trim().max(200).nullable().optional(),
    orderClosed: z.boolean().optional(),
  })
  .refine((b) => b.legalHold !== undefined || b.orderClosed !== undefined, {
    message: 'Indicare almeno uno fra legalHold e orderClosed.',
  });

export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await readApiSession(request);
  if (session === null) {
    return unauthorizedResponse();
  }
  if (!canAccess('admin', session.role)) {
    return forbiddenResponse("La conservazione dei media è riservata all'amministratore.");
  }

  const raw: unknown = await request.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return badRequestResponse('Dati non validi.', { issues: parsed.error.issues });
  }

  const { id } = await context.params;
  const b = parsed.data;
  const esito = await getContainer().assistanceService.setRetention(asAppointmentId(id), {
    ...(b.legalHold === undefined
      ? {}
      : { legalHold: { active: b.legalHold, reason: b.legalHoldReason ?? null } }),
    ...(b.orderClosed === undefined ? {} : { orderClosed: b.orderClosed }),
  });
  if (!esito.ok) {
    return domainErrorResponse(esito.error);
  }
  const a = esito.value;
  return NextResponse.json(
    {
      appointment: {
        id: a.id,
        code: a.code,
        orderClosedAt: a.orderClosedAt,
        legalHoldAt: a.legalHoldAt,
        legalHoldReason: a.legalHoldReason,
      },
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
