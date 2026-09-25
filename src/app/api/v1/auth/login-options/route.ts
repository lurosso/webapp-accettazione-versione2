// GET /api/v1/auth/login-options: le postazioni come le propone il login, libere o occupate con il
// motivo. Il form di login la richiama ogni pochi secondi, così chi è davanti alla pagina (anche
// dall'iPad, dall'indirizzo di rete) vede un collega che si siede o si alza senza ricaricare.
//
// Pubblica come la pagina di login, che mostra già gli stessi dati a chi la apre: nessuna
// informazione in più. Un tetto per indirizzo evita che un client impazzito la martelli.
import { NextResponse, type NextRequest } from 'next/server';
import { loadLoginOptions } from '@/app/_server/login-screen';
import { getContainer } from '@/config/container';
import { hitPerIp, type RateLimitRule } from '@/lib/http/rate-limit';

export const dynamic = 'force-dynamic';

/** Un aggiornamento ogni 5 secondi sono 12 al minuto: il tetto lascia spazio a più schede aperte. */
const PER_IP: RateLimitRule = { limit: 120, windowMs: 60_000 };

export async function GET(request: NextRequest): Promise<NextResponse> {
  const limite = hitPerIp('login-options', request.headers, PER_IP);
  if (!limite.allowed) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED' as const, message: 'Troppe richieste.' } },
      {
        status: 429,
        headers: { 'retry-after': String(limite.retryAfterSeconds), 'cache-control': 'no-store' },
      },
    );
  }
  const options = await loadLoginOptions(getContainer());
  return NextResponse.json({ options }, { headers: { 'cache-control': 'no-store' } });
}
