// POST /api/v1/notifications/[id]/actions — i comandi della schermata Comunicazioni:
// - `claim`: «Prendo io», il contatto è mio e i colleghi lo vedono;
// - `release`: lo lascio (chi l'aveva preso, oppure un responsabile o un amministratore);
// - `retry`: riprova l'invio adesso (il guasto del provider è passato, il numero è stato corretto);
// - `confirm`: ho contattato il cliente, registro l'esito e chiudo la segnalazione.
import { NextResponse, type NextRequest } from 'next/server';
import { readApiSession } from '@/app/_server/session';
import { getContainer } from '@/config/container';
import { MANUAL_CONTACT_OUTCOMES } from '@/domain/entities/notification';
import { asNotificationJobId } from '@/domain/ids';
import {
  badRequestResponse,
  domainErrorResponse,
  forbiddenResponse,
  unauthorizedResponse,
} from '@/lib/http/api-error';
import { canAccess } from '@/lib/navigation';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const ActionBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('claim') }),
  z.object({ action: z.literal('release') }),
  z.object({ action: z.literal('retry') }),
  z.object({
    action: z.literal('confirm'),
    outcome: z.enum(MANUAL_CONTACT_OUTCOMES),
    note: z.string().trim().max(500).nullable().optional(),
  }),
]);

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await readApiSession(request);
  if (session === null) {
    return unauthorizedResponse();
  }
  if (!canAccess('comunicazioni', session.role)) {
    return forbiddenResponse('La schermata Comunicazioni è riservata agli operatori.');
  }

  const raw: unknown = await request.json().catch(() => null);
  const parsed = ActionBody.safeParse(raw);
  if (!parsed.success) {
    return badRequestResponse('Comando non valido.', { issues: parsed.error.issues });
  }

  const { id } = await context.params;
  const comando = parsed.data;
  const esito = await getContainer().communicationsService.act(
    asNotificationJobId(id),
    comando.action === 'confirm'
      ? { action: 'confirm', outcome: comando.outcome, note: comando.note ?? null }
      : { action: comando.action },
    {
      operatorId: session.operatorId,
      displayName: session.displayName,
      privileged: session.role === 'SUPERVISOR' || session.role === 'ADMIN',
    },
  );
  if (!esito.ok) {
    return domainErrorResponse(esito.error);
  }
  return NextResponse.json({ row: esito.value });
}
