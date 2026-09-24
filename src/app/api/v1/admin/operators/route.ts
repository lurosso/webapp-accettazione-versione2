// GET/POST /api/v1/admin/operators — elenco e creazione degli operatori (solo ADMIN).
// Insieme agli operatori si restituiscono sportelli e postazioni: il pannello li usa per i menu
// del form senza una seconda chiamata.
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { readApiSession } from '@/app/_server/session';
import { getContainer } from '@/config/container';
import {
  badRequestResponse,
  domainErrorResponse,
  forbiddenResponse,
  unauthorizedResponse,
} from '@/lib/http/api-error';
import { canAccess } from '@/lib/navigation';

export const dynamic = 'force-dynamic';

const Role = z.enum(['ADVISOR', 'ADMIN', 'KIOSK']);
/** Matricola Infinity: stringa vuota = non collegato. */
const AdvisorCode = z.string().trim().max(20).nullable().optional();

const CreateBody = z.object({
  username: z.string().trim().min(3).max(64),
  displayName: z.string().trim().min(1).max(80),
  role: Role,
  deskIds: z.array(z.string().trim().min(1)).max(20).default([]),
  defaultWorkstationId: z.string().trim().min(1).nullable().default(null),
  password: z.string().min(8).max(200),
  infinityAdvisorCode: AdvisorCode,
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await readApiSession(request);
  if (session === null) {
    return unauthorizedResponse();
  }
  if (!canAccess('admin', session.role)) {
    return forbiddenResponse('La gestione degli operatori è riservata agli amministratori.');
  }
  const container = getContainer();
  const [operators, desks, workstations] = await Promise.all([
    container.operatorAdminService.list(),
    container.repos.referenceData.listDesks(),
    container.repos.referenceData.listWorkstations(),
  ]);
  return NextResponse.json(
    {
      operators,
      desks: desks.map((d) => ({ id: d.id, code: d.code, name: d.name })),
      workstations: workstations.map((w) => ({
        id: w.id,
        code: w.code,
        name: w.name,
        deskId: w.deskId,
      })),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await readApiSession(request);
  if (session === null) {
    return unauthorizedResponse();
  }
  if (!canAccess('admin', session.role)) {
    return forbiddenResponse('La gestione degli operatori è riservata agli amministratori.');
  }
  const raw: unknown = await request.json().catch(() => null);
  const parsed = CreateBody.safeParse(raw);
  if (!parsed.success) {
    return badRequestResponse('Dati operatore non validi.', { issues: parsed.error.issues });
  }
  const esito = await getContainer().operatorAdminService.create(parsed.data, {
    operatorId: session.operatorId,
  });
  if (!esito.ok) {
    return domainErrorResponse(esito.error);
  }
  return NextResponse.json({ operator: esito.value }, { status: 201 });
}
