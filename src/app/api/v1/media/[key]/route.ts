// GET /api/v1/media/[key] — rilegge una foto o un video dell'ispezione.
// È l'indirizzo che lo storage restituisce quando salva un file: i byte arrivano dalla porta
// `IMediaStorage`, quindi la rotta non sa (e non deve sapere) se stanno in memoria o su disco.
//
// Protetta da sessione E da ruolo: le foto del veicolo sono materiale della pratica, non contenuto
// pubblico, e nemmeno un monitor kiosk o il BDC hanno motivo di leggerle. La chiave viene validata
// qui con la stessa forma che lo storage impone (segmenti alfanumerici separati da «/»): tutto il
// resto è 404, senza mai arrivare al file system. Il file esce con il Content-Type della tabella
// dei tipi ammessi, `nosniff`, e una CSP che lo mette in sandbox: anche se un giorno finisse su
// disco qualcosa di interpretabile come documento, servito da qui non potrebbe eseguire nulla.
import { NextResponse, type NextRequest } from 'next/server';
import { readApiSession } from '@/app/_server/session';
import { getContainer } from '@/config/container';
import { badRequestResponse, forbiddenResponse, unauthorizedResponse } from '@/lib/http/api-error';
import { uploadedFileHeaders } from '@/lib/http/security-headers';
import { canAccess } from '@/lib/navigation';

export const dynamic = 'force-dynamic';

interface RouteContext {
  readonly params: Promise<{ readonly key: string }>;
}

/** Stessa forma ammessa da `MediaStorageLocalDisk.resolveKey`: niente `..`, `\`, assoluti. */
const CHIAVE_AMMESSA = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*){0,7}$/;

function nonTrovato(): NextResponse {
  return NextResponse.json(
    { error: { code: 'NOT_FOUND' as const, message: 'Foto non trovata.' } },
    { status: 404 },
  );
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await readApiSession(request);
  if (session === null) {
    return unauthorizedResponse();
  }
  if (!canAccess('accettazione', session.role)) {
    return forbiddenResponse(
      "Le foto e i video delle pratiche sono riservati agli accettatori e all'amministratore.",
    );
  }
  const { key } = await context.params;
  // Next consegna il parametro già decodificato; se contiene ancora un «%» (chiave codificata due
  // volte) si decodifica una sola volta, e una sequenza malformata è un 400, non un 500.
  let chiave = key;
  if (chiave.includes('%')) {
    try {
      chiave = decodeURIComponent(chiave);
    } catch {
      return badRequestResponse('Chiave del media non valida.');
    }
  }
  if (!CHIAVE_AMMESSA.test(chiave)) {
    return nonTrovato();
  }

  const letto = await getContainer().external.mediaStorage.read(chiave);
  if (!letto.ok) {
    return nonTrovato();
  }

  const nomeFile = chiave.slice(chiave.lastIndexOf('/') + 1);
  return new NextResponse(new Uint8Array(letto.value.bytes), {
    headers: {
      ...uploadedFileHeaders(letto.value.mimeType, nomeFile),
      'content-length': String(letto.value.bytes.byteLength),
      'cross-origin-resource-policy': 'same-origin',
    },
  });
}
