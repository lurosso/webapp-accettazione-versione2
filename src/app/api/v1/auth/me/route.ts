// GET /api/v1/auth/me: sessione corrente (per la shell e per verificare che il cookie sia valido).
import { NextResponse, type NextRequest } from 'next/server';
import { readApiSession } from '@/app/_server/session';
import { unauthorizedResponse } from '@/lib/http/api-error';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await readApiSession(request);
  if (session === null) {
    return unauthorizedResponse();
  }
  return NextResponse.json({ session });
}
