// POST /api/v1/auth/logout: cancella il cookie di sessione (il JWT scade da solo entro 8 ore).
import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/app/_server/session';

export const dynamic = 'force-dynamic';

export function POST(): NextResponse {
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}
