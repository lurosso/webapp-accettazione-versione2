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
// Difese, nell'ordine in cui scattano:
// 1. ruolo: caricano e leggono solo accettatori e amministratore (`check-in`/`accettazione`);
//    una sessione del BDC o di un monitor kiosk riceve 403;
// 2. dimensione dichiarata: `Content-Length` obbligatorio e sotto il tetto PRIMA di leggere il
//    corpo — `request.formData()` materializza tutto in memoria, e un multipart da 4 GB avrebbe
//    abbattuto l'unico processo dell'officina prima di arrivare a qualunque controllo;
// 3. campi testuali con schema (nota ≤ 500 caratteri, categoria dall'elenco);
// 4. il tipo REALE del file lo decide il servizio dai primi byte, non `file.type` (che dichiara il
//    client): un eseguibile rinominato `.jpg` viene rifiutato lì.
//
// GET restituisce l'elenco dei media già acquisiti, con l'indirizzo per rileggerli, il tipo
// (foto o video) e la parte del veicolo a cui appartengono.
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { correlationIdFrom, readApiSession } from '@/app/_server/session';
import { MAX_PHOTO_BYTES, MAX_VIDEO_BYTES } from '@/application/media/InspectionService';
import { getContainer } from '@/config/container';
import { isMediaCategory } from '@/domain/entities/media-asset';
import { asAppointmentId } from '@/domain/ids';
import {
  badRequestResponse,
  domainErrorResponse,
  forbiddenResponse,
  unauthorizedResponse,
} from '@/lib/http/api-error';
import { canAccess } from '@/lib/navigation';

export const dynamic = 'force-dynamic';

/** Tetto al corpo dell'intera richiesta: il video più grande ammesso più il contorno multipart. */
export const MAX_UPLOAD_REQUEST_BYTES = MAX_VIDEO_BYTES + 512 * 1024;

const CampiTestuali = z.object({
  nota: z.string().trim().max(500).optional(),
  categoria: z.string().trim().max(32).optional(),
  // Identificativo del caricamento scelto dal tablet: rende idempotente un nuovo invio.
  idCaricamento: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{8,64}$/)
    .optional(),
});

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

function campoTesto(valore: FormDataEntryValue | null): string | undefined {
  return typeof valore === 'string' ? valore : undefined;
}

const MB = 1024 * 1024;

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
  const { id } = await context.params;
  const media = await getContainer().inspectionService.listPhotos(asAppointmentId(id));
  return NextResponse.json(
    { photos: media.map(toJson) },
    { headers: { 'cache-control': 'no-store' } },
  );
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await readApiSession(request);
  if (session === null) {
    return unauthorizedResponse();
  }
  if (!canAccess('check-in', session.role)) {
    return forbiddenResponse(
      'Le foto del check-in le acquisisce chi sta al veicolo: accettatori e amministratore.',
    );
  }

  const lunghezza = request.headers.get('content-length');
  if (lunghezza === null) {
    return NextResponse.json(
      {
        error: {
          code: 'BAD_REQUEST' as const,
          message: 'Content-Length obbligatorio per il caricamento di foto e video.',
        },
      },
      { status: 411 },
    );
  }
  const dichiarati = Number.parseInt(lunghezza, 10);
  if (!Number.isFinite(dichiarati) || dichiarati < 0) {
    return badRequestResponse('Content-Length non valido.');
  }
  if (dichiarati > MAX_UPLOAD_REQUEST_BYTES) {
    return NextResponse.json(
      {
        error: {
          code: 'BAD_REQUEST' as const,
          message: `File troppo grande: al massimo ${Math.floor(MAX_VIDEO_BYTES / MB)} MB per un video e ${Math.floor(MAX_PHOTO_BYTES / MB)} MB per una foto.`,
          details: { maxBytes: MAX_UPLOAD_REQUEST_BYTES },
        },
      },
      { status: 413 },
    );
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
  const campi = CampiTestuali.safeParse({
    nota: campoTesto(form.get('nota')),
    categoria: campoTesto(form.get('categoria')),
    idCaricamento: campoTesto(form.get('idCaricamento')),
  });
  if (!campi.success) {
    return badRequestResponse('Campi del media non validi.', { issues: campi.error.issues });
  }
  const categoria = campi.data.categoria ?? '';
  if (categoria !== '' && !isMediaCategory(categoria)) {
    return badRequestResponse('Categoria del media non valida (campo `categoria`).', {
      ricevuto: categoria,
    });
  }
  // Primo filtro sulla dimensione con il tipo DICHIARATO: rifiuta subito il grosso senza aspettare
  // il servizio. Il tipo vero, e il limite che ne deriva, li decide il servizio dai byte.
  const dichiarato = file.type === '' ? 'image/jpeg' : file.type;
  const maxBytes = dichiarato.startsWith('video/') ? MAX_VIDEO_BYTES : MAX_PHOTO_BYTES;
  if (file.size > maxBytes) {
    return badRequestResponse(
      dichiarato.startsWith('video/')
        ? 'Video troppo lungo: registra una ripresa più breve del giro del veicolo.'
        : 'Foto troppo grande: riprova con una risoluzione inferiore.',
      { maxBytes },
    );
  }

  const { id } = await context.params;
  const container = getContainer();
  const correlationId = correlationIdFrom(request);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const nota = campi.data.nota ?? '';

  const salvata = await container.inspectionService.addMedia({
    appointmentId: asAppointmentId(id),
    operatorId: session.operatorId,
    bytes,
    mimeType: dichiarato,
    category: isMediaCategory(categoria) ? categoria : null,
    note: nota === '' ? null : nota,
    clientUploadId: campi.data.idCaricamento ?? null,
  });
  if (!salvata.ok) {
    return domainErrorResponse(salvata.error, { 'x-correlation-id': correlationId });
  }

  return NextResponse.json(
    { photo: toJson(salvata.value) },
    { status: 201, headers: { 'x-correlation-id': correlationId } },
  );
}
