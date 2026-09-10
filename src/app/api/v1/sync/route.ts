// POST /api/v1/sync: sincronizzazione manuale dell'agenda Infinity per la giornata corrente.
// Regola: SUPERVISOR/ADMIN sempre; ADVISOR solo come "Riprova" quando l'ultima sync è fallita o
// manca del tutto (fallback: l'officina non deve dipendere da chi è di turno).
import { NextResponse, type NextRequest } from 'next/server';
import { readApiSession } from '@/app/_server/session';
import { getContainer } from '@/config/container';
import { forbiddenResponse, unauthorizedResponse } from '@/lib/http/api-error';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await readApiSession(request);
  if (session === null) {
    return unauthorizedResponse();
  }
  const container = getContainer();
  const today = container.clock.today();
  if (session.role === 'ADVISOR') {
    const latest = await container.syncService.getLatestRun(today);
    if (latest !== null && latest.status !== 'FAILED') {
      return forbiddenResponse(
        'La sincronizzazione di oggi è già stata eseguita: solo un responsabile può ripeterla.',
      );
    }
  }
  const run = await container.syncService.runDailySync(today, 'MANUAL', session.operatorId);
  return NextResponse.json({ run }, { status: run.status === 'FAILED' ? 502 : 200 });
}
