// PATCH /api/v1/admin/operators/[id] — modifica di un operatore (solo ADMIN).
// Nome, ruolo, sportelli, postazione predefinita, attivazione. Il nome utente non si cambia.
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { readApiSession } from '@/app/_server/session';
import { getContainer } from '@/config/container';
import { asOperatorId } from '@/domain/ids';
import {
  badRequestResponse,
  domainErrorResponse,
  forbiddenResponse,
  unauthorizedResponse,
} from '@/lib/http/api-error';
import { canAccess } from '@/lib/navigation';

export const dynamic = 'force-dynamic';

const UpdateBody = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    role: z.enum(['ADVISOR', 'ADMIN', 'KIOSK']).optional(),
    /** Matricola Infinity; null o stringa vuota = scollegare. */
    infinityAdvisorCode: z.string().trim().max(20).nullable().optional(),
    deskIds: z.array(z.string().trim().min(1)).max(20).optional(),
    defaultWorkstationId: z.string().trim().min(1).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Nessun campo da modificare.' });

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await readApiSession(request);
  if (session === null) {
    return unauthorizedResponse();
  }
  if (!canAccess('admin', session.role)) {
    return forbiddenResponse('La gestione degli operatori è riservata agli amministratori.');
  }
  const raw: unknown = await request.json().catch(() => null);
  const parsed = UpdateBody.safeParse(raw);
  if (!parsed.success) {
    return badRequestResponse('Dati operatore non validi.', { issues: parsed.error.issues });
  }
  const { id } = await context.params;
  const esito = await getContainer().operatorAdminService.update(asOperatorId(id), parsed.data, {
    operatorId: session.operatorId,
  });
  if (!esito.ok) {
    return domainErrorResponse(esito.error);
  }
  return NextResponse.json({ operator: esito.value });
}
