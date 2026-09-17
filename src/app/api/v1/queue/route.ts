// GET /api/v1/queue?date=YYYY-MM-DD&deskId=&view=desk|global|returns
// Coda della giornata per la dashboard (polling ogni 3 s): righe arricchite, occupazione degli
// sportelli (senza il token dei monitor, che resta un segreto dei kiosk),
// ultima sync e dati di riferimento. Senza `deskId` usa lo sportello della postazione di sessione.
// Con `view=returns` le righe sono le riconsegne (flusso RETURN), che non passano dalla coda;
// `returnsCount` dice quante sono anche nelle altre viste, per il pulsante della scheda.
import { NextResponse, type NextRequest } from 'next/server';
import { readApiSession } from '@/app/_server/session';
import { toBayOccupancyOptions } from '@/application/queue/QueueService';
import { getContainer } from '@/config/container';
import { asDeskId } from '@/domain/ids';
import { isIsoDate } from '@/domain/value-objects/iso-date';
import { badRequestResponse, unauthorizedResponse } from '@/lib/http/api-error';
import type { QueueResponse, QueueView } from '@/modules/reception/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await readApiSession(request);
  if (session === null) {
    return unauthorizedResponse();
  }
  const container = getContainer();
  const { searchParams } = request.nextUrl;

  const dateParam = searchParams.get('date');
  if (dateParam !== null && !isIsoDate(dateParam)) {
    return badRequestResponse('Parametro `date` non valido: atteso YYYY-MM-DD.');
  }
  const businessDate = dateParam ?? container.clock.today();
  const richiesta = searchParams.get('view');
  const view: QueueView =
    richiesta === 'global' ? 'global' : richiesta === 'returns' ? 'returns' : 'desk';
  const flow = view === 'returns' ? 'RETURN' : 'INTAKE';

  const [desks, brands, workstations, bays] = await Promise.all([
    container.repos.referenceData.listDesks(),
    container.repos.referenceData.listBrands(),
    container.repos.referenceData.listWorkstations(),
    container.queueService.getBayOccupancy(businessDate),
  ]);

  const requestedDesk = searchParams.get('deskId');
  const sessionDesk =
    workstations.find((w) => w.id === session.workstationId)?.deskId ?? session.deskIds[0] ?? null;
  const deskId =
    view !== 'desk' ? null : requestedDesk !== null ? asDeskId(requestedDesk) : sessionDesk;
  if (deskId !== null && !desks.some((d) => d.id === deskId)) {
    return badRequestResponse('Sportello sconosciuto.', { deskId });
  }

  const [rows, lastSync, riconsegne] = await Promise.all([
    container.queueService.getQueue({
      businessDate,
      deskId,
      globalView: view === 'global',
      flow,
    }),
    container.syncService.getLatestRun(businessDate),
    container.repos.appointments.listByDate(businessDate, { flow: 'RETURN' }),
  ]);

  const body: QueueResponse = {
    businessDate,
    serverTime: container.clock.nowIso(),
    timeZone: container.env.timeZone,
    view,
    flow,
    returnsCount: riconsegne.length,
    deskId,
    rows,
    bays: toBayOccupancyOptions(bays),
    lastSync,
    desks,
    brands,
    workstations,
  };
  return NextResponse.json(body, { headers: { 'cache-control': 'no-store' } });
}
