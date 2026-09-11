// GET /api/v1/media/[key] — rilegge una foto dell'ispezione.
// È l'indirizzo che lo storage restituisce quando salva un file: con il mock i byte stanno in
// memoria, con un archivio reale questa rotta diventerà un rinvio all'URL firmato. Protetta da
// sessione: le foto del veicolo sono materiale della pratica, non contenuto pubblico.
import { NextResponse, type NextRequest } from 'next/server';
import { readApiSession } from '@/app/_server/session';
import { getContainer } from '@/config/container';
import { unauthorizedResponse } from '@/lib/http/api-error';

export const dynamic = 'force-dynamic';

interface RouteContext {
  readonly params: Promise<{ readonly key: string }>;
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await readApiSession(request);
  if (session === null) {
    return unauthorizedResponse();
  }
  const { key } = await context.params;
  const storage = getContainer().external.mediaStorage;

  // Solo l'implementazione in memoria sa restituire i byte: con un archivio reale questa rotta
  // risponderà con un rinvio, e il ramo qui sotto non verrà più usato.
  const leggibile = storage as {
    get?: (k: string) => { bytes: Uint8Array; mimeType: string } | null;
  };
  const blob = typeof leggibile.get === 'function' ? leggibile.get(decodeURIComponent(key)) : null;
  if (blob === null) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND' as const, message: 'Foto non trovata.' } },
      { status: 404 },
    );
  }

  return new NextResponse(new Uint8Array(blob.bytes), {
    headers: {
      'content-type': blob.mimeType,
      'content-length': String(blob.bytes.byteLength),
      // Materiale della pratica: non finisce nelle cache condivise.
      'cache-control': 'private, max-age=300',
    },
  });
}
