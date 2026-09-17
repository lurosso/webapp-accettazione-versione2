// POST /api/v1/appointments/[id]/media — foto o video acquisiti al veicolo dal tablet (modulo E).
// Il corpo è multipart/form-data con il file nel campo `foto` (o `file`/`video`, come li nomina
// chi carica): è quello che producono <input type="file" accept="image/*" capture="environment">
// e l'equivalente con accept="video/*" sulla fotocamera del tablet.
//
// Il campo `categoria` è FACOLTATIVO: indica quale parte del veicolo è stata ripresa (FRONT, REAR,
// LEFT, …) quando il tablet sta riempiendo uno slot del giro. Senza categoria una foto viene
// archiviata come aggiuntiva e un video come ripresa del giro intero: nessuna acquisizione viene
// rifiutata solo perché l'accettatore non ha scelto una casella.
//
// GET restituisce l'elenco dei media già acquisiti, con l'indirizzo per rileggerli, il tipo
// (foto o video) e la parte del veicolo a cui appartengono.
import { NextResponse, type NextRequest } from 'next/server';
import { correlationIdFrom, readApiSession } from '@/app/_server/session';
import { MAX_PHOTO_BYTES, MAX_VIDEO_BYTES } from '@/application/media/InspectionService';
import { getContainer } from '@/config/container';
import { isMediaCategory } from '@/domain/entities/media-asset';
import { asAppointmentId } from '@/domain/ids';
import {
  badRequestResponse,
  domainErrorResponse,
  unauthorizedResponse,
} from '@/lib/http/api-error';

export const dynamic = 'force-dynamic';

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

/** Forma con cui foto e video escono da questa rotta (identica in GET e POST). */
function toJson(media: {
  readonly asset: {
    readonly id: string;
    readonly kind: string;
    readonly mimeType: string;
    readonly capturedAt: string;
    readonly sizeBytes: number;
    readonly category: string | null;
    readonly archivedAt: string | null;
  };
  readonly url: string;
}) {
  return {
    id: media.asset.id,
    url: media.url,
    kind: media.asset.kind,
    mimeType: media.asset.mimeType,
    capturedAt: media.asset.capturedAt,
    sizeBytes: media.asset.sizeBytes,
    category: media.asset.category,
    archivedAt: media.asset.archivedAt,
  };
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await readApiSession(request);
  if (session === null) {
    return unauthorizedResponse();
  }
  const { id } = await context.params;
  const media = await getContainer().inspectionService.listPhotos(asAppointmentId(id));
  return NextResponse.json({ photos: media.map(toJson) });
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await readApiSession(request);
  if (session === null) {
    return unauthorizedResponse();
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return badRequestResponse('Corpo della richiesta non valido: atteso multipart/form-data.');
  }

  const file = form.get('foto') ?? form.get('file') ?? form.get('video');
  if (!(file instanceof File)) {
    return badRequestResponse('Nessun file ricevuto nel campo `foto`.');
  }
  // Il tablet non sempre dichiara il tipo: senza indicazioni si assume una foto JPEG, perché è
  // quello che produce la fotocamera in acquisizione diretta.
  const mimeType = file.type === '' ? 'image/jpeg' : file.type;
  const maxBytes = mimeType.startsWith('video/') ? MAX_VIDEO_BYTES : MAX_PHOTO_BYTES;
  if (file.size > maxBytes) {
    return badRequestResponse(
      mimeType.startsWith('video/')
        ? 'Video troppo lungo: registra una ripresa più breve del giro del veicolo.'
        : 'Foto troppo grande: riprova con una risoluzione inferiore.',
      { maxBytes },
    );
  }

  const { id } = await context.params;
  const container = getContainer();
  const correlationId = correlationIdFrom(request);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const nota = form.get('nota');
  const categoria = form.get('categoria');
  if (typeof categoria === 'string' && categoria !== '' && !isMediaCategory(categoria)) {
    return badRequestResponse('Categoria del media non valida (campo `categoria`).', {
      ricevuto: categoria,
    });
  }

  const salvata = await container.inspectionService.addMedia({
    appointmentId: asAppointmentId(id),
    operatorId: session.operatorId,
    bytes,
    mimeType,
    category: isMediaCategory(categoria) ? categoria : null,
    note: typeof nota === 'string' && nota.trim() !== '' ? nota.trim() : null,
  });
  if (!salvata.ok) {
    return domainErrorResponse(salvata.error, { 'x-correlation-id': correlationId });
  }

  return NextResponse.json(
    { photo: toJson(salvata.value) },
    { status: 201, headers: { 'x-correlation-id': correlationId } },
  );
}
