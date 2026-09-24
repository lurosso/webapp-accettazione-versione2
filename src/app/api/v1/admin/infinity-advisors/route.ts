// GET /api/v1/admin/infinity-advisors — gli accettatori che Infinity assegna alle prenotazioni
// (matricola e nome dal planning degli ultimi quattordici giorni e dei prossimi sette), con quante
// prenotazioni hanno e l'account a cui sono già collegati. Serve all'amministratore per scrivere la
// matricola giusta sull'account di ogni accettatore: da lì nascono «Le mie prenotazioni».
import { NextResponse, type NextRequest } from 'next/server';
import { readApiSession } from '@/app/_server/session';
import { getContainer } from '@/config/container';
import { forbiddenResponse, unauthorizedResponse } from '@/lib/http/api-error';
import { canAccess } from '@/lib/navigation';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await readApiSession(request);
  if (session === null) {
    return unauthorizedResponse();
  }
  if (!canAccess('admin', session.role)) {
    return forbiddenResponse('La gestione degli operatori è riservata agli amministratori.');
  }
  const advisors = await getContainer().infinityAdvisorDirectory.list();
  return NextResponse.json({ advisors }, { headers: { 'cache-control': 'no-store' } });
}
