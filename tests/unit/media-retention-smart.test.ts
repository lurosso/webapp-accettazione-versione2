// Ritenzione intelligente: il tempo da solo non basta a cancellare.
//
// Tre condizioni in AND: retention trascorsa, commessa chiusa, nessun vincolo legale. Il caso che
// motiva tutto è l'auto ferma quattro mesi in attesa di un ricambio raro: al novantesimo giorno il
// cron non deve toccare il video di check-in, perché la commessa è ancora aperta.
import { describe, expect, it } from 'vitest';
import { AssistanceService } from '@/application/admin/AssistanceService';
import { InspectionArchiveService } from '@/application/media/InspectionArchiveService';
import { InspectionService } from '@/application/media/InspectionService';
import { QueueService, type ActionContext } from '@/application/queue/QueueService';
import { isWorkClosed, retentionProtection, type Appointment } from '@/domain/entities/appointment';
import { asAppointmentId, asOperatorId, asWorkstationId } from '@/domain/ids';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import { addMediaAsInProgress } from '../helpers/media-fixtures';
import { jpegBytes } from '../helpers/media-bytes';
import { buildTestEnv, makeAppointment, TestClock } from '../helpers/fixtures';

const RETENTION_DAYS = 90;
const GIORNO_MS = 24 * 60 * 60_000;
/** Cento giorni: ben oltre i novanta della retention. È il caso del prompt. */
const CENTO_GIORNI = 100 * GIORNO_MS;

function setup() {
  const clock = new TestClock();
  const env = buildTestEnv(clock);
  const queueService = new QueueService({
    appointments: env.appointments,
    referenceData: env.referenceData,
    operators: env.operators,
    notifications: env.notifications,
    crmNotifier: env.crmNotifier,
    eventBus: env.eventBus,
    clock,
    ids: env.ids,
    logger: env.logger,
  });
  const inspection = new InspectionService({
    appointments: env.appointments,
    media: env.media,
    mediaStorage: env.mediaStorage,
    queueService,
    crmNotifier: env.crmNotifier,
    clock,
    ids: env.ids,
    logger: env.logger,
    retentionDays: RETENTION_DAYS,
  });
  const archive = new InspectionArchiveService({
    appointments: env.appointments,
    media: env.media,
    mediaStorage: env.mediaStorage,
    referenceData: env.referenceData,
    clock,
    logger: env.logger,
    hardDeleteDays: 90,
  });
  const assistance = new AssistanceService({
    appointments: env.appointments,
    referenceData: env.referenceData,
    operators: env.operators,
    claims: env.workstationClaims,
    clock,
  });
  const ctx: ActionContext = {
    operatorId: asOperatorId('op-advisor-1'),
    workstationId: asWorkstationId('ws-p1'),
    correlationId: 'corr-smart-retention',
  };
  return { env, clock, inspection, archive, assistance, ctx };
}

async function insert(env: ReturnType<typeof buildTestEnv>, a: Appointment): Promise<Appointment> {
  const r = await env.appointments.insert(a);
  if (!r.ok) {
    throw new Error(r.error.message);
  }
  return r.value;
}

/** Una pratica accettata (check-in fatto) con una foto, poi cento giorni di silenzio. */
async function pratricaVecchiaConFoto(
  s: ReturnType<typeof setup>,
  overrides: Partial<Appointment> = {},
): Promise<{ readonly a: Appointment; readonly key: string }> {
  const a = await insert(s.env, makeAppointment({ status: 'COMPLETED', ...overrides }));
  const salvata = await addMediaAsInProgress(s.env.appointments, s.inspection, {
    appointmentId: a.id,
    operatorId: s.ctx.operatorId,
    bytes: jpegBytes(512),
    mimeType: 'image/jpeg',
    category: 'FRONT',
  });
  if (!salvata.ok) {
    throw new Error(salvata.error.message);
  }
  s.clock.advance(CENTO_GIORNI);
  return { a, key: salvata.value.asset.storageKey };
}

const NIENTE_PROTETTO = { orderOpen: 0, legalHold: 0 };

describe('Regola di dominio: cosa protegge i media', () => {
  it('una commessa senza chiusura è aperta, e protegge', () => {
    const a = makeAppointment({ status: 'COMPLETED' });
    expect(isWorkClosed(a)).toBe(false);
    expect(retentionProtection(a)).toBe('ORDER_OPEN');
  });

  it('assente e annullata non hanno commessa: vale solo il tempo', () => {
    expect(isWorkClosed(makeAppointment({ status: 'NO_SHOW' }))).toBe(true);
    expect(isWorkClosed(makeAppointment({ status: 'CANCELLED' }))).toBe(true);
    expect(retentionProtection(makeAppointment({ status: 'NO_SHOW' }))).toBeNull();
  });

  it('il vincolo legale viene prima di tutto, anche a commessa chiusa', () => {
    const a = makeAppointment({
      status: 'COMPLETED',
      orderClosedAt: '2026-09-10T06:00:00.000Z' as IsoDateTime,
      legalHoldAt: '2026-09-11T06:00:00.000Z' as IsoDateTime,
    });
    expect(retentionProtection(a)).toBe('LEGAL_HOLD');
  });
});

describe('InspectionArchiveService: il tempo da solo non cancella', () => {
  it('cento giorni dopo, con la commessa ancora aperta, il file resta', async () => {
    const s = setup();
    const { key } = await pratricaVecchiaConFoto(s);

    const esito = await s.archive.purgeExpired();
    expect(esito).toEqual({
      examined: 1,
      archived: 0,
      failed: 0,
      deleted: 0,
      protected: { orderOpen: 1, legalHold: 0 },
    });
    expect(s.env.mediaStorage.get(key)).not.toBeNull();
  });

  it('cento giorni dopo, con un vincolo legale, il file resta anche a commessa chiusa', async () => {
    const s = setup();
    const { key } = await pratricaVecchiaConFoto(s, {
      orderClosedAt: '2026-09-10T06:00:00.000Z' as IsoDateTime,
      legalHoldAt: '2026-09-10T07:00:00.000Z' as IsoDateTime,
      legalHoldReason: 'Contestazione graffio paraurti',
    });

    const esito = await s.archive.purgeExpired();
    expect(esito.protected).toEqual({ orderOpen: 0, legalHold: 1 });
    expect(esito.archived).toBe(0);
    expect(s.env.mediaStorage.get(key)).not.toBeNull();
  });

  it('a commessa chiusa e senza vincolo, scaduto il tempo, il file viene eliminato', async () => {
    const s = setup();
    const { key } = await pratricaVecchiaConFoto(s, {
      orderClosedAt: '2026-09-10T06:00:00.000Z' as IsoDateTime,
    });

    const esito = await s.archive.purgeExpired();
    expect(esito).toEqual({
      examined: 1,
      archived: 1,
      failed: 0,
      deleted: 0,
      protected: NIENTE_PROTETTO,
    });
    expect(s.env.mediaStorage.get(key)).toBeNull();
  });

  it('una pratica assente non ha commessa: i suoi media scadono col solo tempo', async () => {
    const s = setup();
    const { key } = await pratricaVecchiaConFoto(s, { status: 'NO_SHOW' });

    expect((await s.archive.purgeExpired()).archived).toBe(1);
    expect(s.env.mediaStorage.get(key)).toBeNull();
  });

  it('tolta la protezione, il giro successivo elimina: la protezione rimanda, non azzera', async () => {
    const s = setup();
    const { a, key } = await pratricaVecchiaConFoto(s);

    expect((await s.archive.purgeExpired()).protected.orderOpen).toBe(1);
    expect(s.env.mediaStorage.get(key)).not.toBeNull();

    const chiusa = await s.assistance.setRetention(a.id, { orderClosed: true });
    expect(chiusa.ok).toBe(true);

    expect((await s.archive.purgeExpired()).archived).toBe(1);
    expect(s.env.mediaStorage.get(key)).toBeNull();
  });
});

describe('AssistanceService.setRetention', () => {
  it('mette e toglie il vincolo legale, con il motivo, senza spostare la data se già presente', async () => {
    const s = setup();
    const a = await insert(s.env, makeAppointment({ status: 'COMPLETED' }));

    const messo = await s.assistance.setRetention(a.id, {
      legalHold: { active: true, reason: 'Contenzioso in corso' },
    });
    expect(messo.ok && messo.value.legalHoldAt).toBe(s.clock.nowIso());
    expect(messo.ok && messo.value.legalHoldReason).toBe('Contenzioso in corso');
    const primaData = messo.ok ? messo.value.legalHoldAt : null;

    s.clock.advance(GIORNO_MS);
    const ribadito = await s.assistance.setRetention(a.id, {
      legalHold: { active: true, reason: 'Aggiornato' },
    });
    expect(ribadito.ok && ribadito.value.legalHoldAt).toBe(primaData);
    expect(ribadito.ok && ribadito.value.legalHoldReason).toBe('Aggiornato');

    const tolto = await s.assistance.setRetention(a.id, {
      legalHold: { active: false, reason: null },
    });
    expect(tolto.ok && tolto.value.legalHoldAt).toBeNull();
    expect(tolto.ok && tolto.value.legalHoldReason).toBeNull();
  });

  it('chiude e riapre la commessa', async () => {
    const s = setup();
    const a = await insert(s.env, makeAppointment({ status: 'COMPLETED' }));

    const chiusa = await s.assistance.setRetention(a.id, { orderClosed: true });
    expect(chiusa.ok && chiusa.value.orderClosedAt).toBe(s.clock.nowIso());

    const riaperta = await s.assistance.setRetention(a.id, { orderClosed: false });
    expect(riaperta.ok && riaperta.value.orderClosedAt).toBeNull();
  });

  it('una pratica sconosciuta è NOT_FOUND, una richiesta vuota non tocca la versione', async () => {
    const s = setup();
    const ignota = await s.assistance.setRetention(asAppointmentId('app-inesistente'), {
      orderClosed: true,
    });
    expect(!ignota.ok && ignota.error.code).toBe('NOT_FOUND');

    const a = await insert(s.env, makeAppointment());
    const vuota = await s.assistance.setRetention(a.id, {});
    expect(vuota.ok && vuota.value.version).toBe(a.version);
  });
});
