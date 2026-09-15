// POST /api/v1/admin/spoki/test: invio di prova di un template WhatsApp a un numero scelto a mano.
// In simulazione finisce nel registro; in live consuma un messaggio reale. Solo amministratori.
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { correlationIdFrom, readApiSession } from '@/app/_server/session';
import { SPOKI_TEST_KINDS } from '@/application/messaging/SpokiDiagnosticsService';
import { getContainer } from '@/config/container';
import {
  badRequestResponse,
  domainErrorResponse,
  forbiddenResponse,
  unauthorizedResponse,
} from '@/lib/http/api-error';
import { canAccess } from '@/lib/navigation';

export const dynamic = 'force-dynamic';

const TestBody = z.object({
  phone: z.string().trim().min(6).max(32),
  kind: z.enum(SPOKI_TEST_KINDS),
  firstName: z.string().trim().max(60).optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await readApiSession(request);
  if (session === null) {
    return unauthorizedResponse();
  }
  if (!canAccess('admin', session.role)) {
    return forbiddenResponse();
  }
  const raw: unknown = await request.json().catch(() => null);
  const parsed = TestBody.safeParse(raw);
  if (!parsed.success) {
    return badRequestResponse('Dati del messaggio di prova non validi.', {
      issues: parsed.error.issues,
    });
  }
  const correlationId = correlationIdFrom(request);
  const esito = await getContainer().spokiDiagnosticsService.sendTest(
    {
      phone: parsed.data.phone,
      kind: parsed.data.kind,
      firstName: parsed.data.firstName === '' ? undefined : parsed.data.firstName,
    },
    { operatorId: session.operatorId },
  );
  const headers = { 'x-correlation-id': correlationId };
  if (!esito.ok) {
    return domainErrorResponse(esito.error, headers);
  }
  return NextResponse.json(esito.value, { headers });
}
