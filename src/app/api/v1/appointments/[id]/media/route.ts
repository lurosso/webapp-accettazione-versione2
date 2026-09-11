// POST /api/v1/appointments/[id]/media — foto scattata al veicolo dal tablet (modulo E).
// Il corpo è multipart/form-data con il campo `foto`, cioè quello che produce
// <input type="file" accept="image/*" capture="environment"> sulla fotocamera del tablet, più il
// campo `categoria` che dice quale parte del veicolo è stata ripresa (FRONT, REAR, LEFT, …).
//
// GET restituisce l'elenco delle foto già acquisite, con l'indirizzo per rileggerle e la parte
// del veicolo a cui appartengono.
import { NextResponse, type NextRequest } from 'next/server';
import { correlationIdFrom, readApiSession } from '@/app/_server/session';
import { MAX_PHOTO_BYTES } from '@/application/media/InspectionService';
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

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await readApiSession(request);
  if (session === null) {
    return unauthorizedResponse();
  }
  const { id } = await context.params;
  const foto = await getContainer().inspectionService.listPhotos(asAppointmentId(id));
  return NextResponse.json({
    photos: foto.map((f) => ({
      id: f.asset.id,
      url: f.url,
      capturedAt: f.asset.capturedAt,
      sizeBytes: f.asset.sizeBytes,
      category: f.asset.category,
    })),
  });
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

  const file = form.get('foto');
  if (!(file instanceof File)) {
    return badRequestResponse('Nessuna foto ricevuta nel campo `foto`.');
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return badRequestResponse('Foto troppo grande: riprova con una risoluzione inferiore.', {
      maxBytes: MAX_PHOTO_BYTES,
    });
  }

  const { id } = await context.params;
  const container = getContainer();
  const correlationId = correlationIdFrom(request);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const nota = form.get('nota');
  const categoria = form.get('categoria');
  if (!isMediaCategory(categoria)) {
    return badRequestResponse('Categoria della foto mancante o non valida (campo `categoria`).', {
      ricevuto: typeof categoria === 'string' ? categoria : null,
    });
  }

  const salvata = await container.inspectionService.addPhoto({
    appointmentId: asAppointmentId(id),
    operatorId: session.operatorId,
    bytes,
    // Il tablet non sempre dichiara il tipo: in quel caso si assume una foto JPEG.
    mimeType: file.type === '' ? 'image/jpeg' : file.type,
    category: categoria,
    note: typeof nota === 'string' && nota.trim() !== '' ? nota.trim() : null,
  });
  if (!salvata.ok) {
    return domainErrorResponse(salvata.error, { 'x-correlation-id': correlationId });
  }

  return NextResponse.json(
    {
      photo: {
        id: salvata.value.asset.id,
        url: salvata.value.url,
        capturedAt: salvata.value.asset.capturedAt,
        sizeBytes: salvata.value.asset.sizeBytes,
        category: salvata.value.asset.category,
      },
    },
    { status: 201, headers: { 'x-correlation-id': correlationId } },
  );
}
