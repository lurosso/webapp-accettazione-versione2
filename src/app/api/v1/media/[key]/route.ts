// GET /api/v1/media/[key] — rilegge una foto dell'ispezione.
// È l'indirizzo che lo storage restituisce quando salva un file: i byte arrivano dalla porta
// `IMediaStorage`, quindi la rotta non sa (e non deve sapere) se stanno in memoria o su disco.
// Protetta da sessione: le foto del veicolo sono materiale della pratica, non contenuto pubblico.
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

  const letto = await storage.read(decodeURIComponent(key));
  if (!letto.ok) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND' as const, message: 'Foto non trovata.' } },
      { status: 404 },
    );
  }

  return new NextResponse(new Uint8Array(letto.value.bytes), {
    headers: {
      'content-type': letto.value.mimeType,
      'content-length': String(letto.value.bytes.byteLength),
      // Materiale della pratica: non finisce nelle cache condivise.
      'cache-control': 'private, max-age=300',
    },
  });
}
