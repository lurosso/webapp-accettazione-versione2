// GET /api/v1/admin/spoki: stato dell'integrazione WhatsApp (provider, modalità, chiave mascherata,
// URL dei template) e registro delle chiamate simulate o reali. Solo amministratori.
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
    return forbiddenResponse();
  }
  return NextResponse.json(getContainer().spokiDiagnosticsService.overview(), {
    headers: { 'cache-control': 'no-store' },
  });
}
