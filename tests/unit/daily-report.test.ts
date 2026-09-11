import { describe, expect, it } from 'vitest';
import { DailyReportService } from '@/application/reporting/DailyReportService';
import type { Appointment } from '@/domain/entities/appointment';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import { buildTestEnv, makeAppointment, TEST_DATE } from '../helpers/fixtures';

function setup() {
  const env = buildTestEnv();
  const report = new DailyReportService({
    appointments: env.appointments,
    referenceData: env.referenceData,
    operators: env.operators,
    media: env.media,
    logger: env.logger,
  });
  return { env, report };
}

const AT = (hhmm: string): IsoDateTime => `2026-09-10T${hhmm}:00.000Z` as IsoDateTime;

async function insert(env: ReturnType<typeof buildTestEnv>, a: Appointment): Promise<Appointment> {
  const r = await env.appointments.insert(a);
  if (!r.ok) {
    throw new Error(r.error.message);
  }
  return r.value;
}

describe('DailyReportService: indicatori della giornata', () => {
  it('calcola attesa e lavorazione medie solo sulle pratiche che hanno i due istanti', async () => {
    const { env, report } = setup();
    // Attesa 10 min, lavorazione 30 min.
    await insert(
      env,
      makeAppointment({
        scheduledAt: AT('08:00'),
        takenAt: AT('08:10'),
        completedAt: AT('08:40'),
        status: 'COMPLETED',
      }),
    );
    // Attesa 20 min, lavorazione 10 min.
    await insert(
      env,
      makeAppointment({
        scheduledAt: AT('09:00'),
        takenAt: AT('09:20'),
        completedAt: AT('09:30'),
        status: 'COMPLETED',
      }),
    );
    // Mai presa in carico: non entra in nessuna delle due medie.
    await insert(env, makeAppointment({ scheduledAt: AT('10:00'), status: 'NO_SHOW' }));

    const r = await report.getDailyReport(TEST_DATE);
    expect(r.averageWait).toEqual({ minutes: 15, sampleSize: 2 });
    expect(r.averageService).toEqual({ minutes: 20, sampleSize: 2 });
    expect(r.longestWaitMinutes).toBe(20);
    expect(r.total).toBe(3);
  });

  it("l'attesa parte dall'orario effettivo, non da quello dell'agenda", async () => {
    const { env, report } = setup();
    // Cliente in ritardo rimesso in coda alle 10:00 e preso in carico alle 10:05: ha atteso 5
    // minuti, non le due ore passate dall'orario di prenotazione.
    await insert(
      env,
      makeAppointment({
        scheduledAt: AT('08:00'),
        rescheduledAt: AT('10:00'),
        takenAt: AT('10:05'),
        status: 'IN_PROGRESS',
      }),
    );

    const r = await report.getDailyReport(TEST_DATE);
    expect(r.averageWait.minutes).toBe(5);
  });

  it('le percentuali di esito sono sul totale della giornata', async () => {
    const { env, report } = setup();
    await insert(env, makeAppointment({ status: 'COMPLETED', completedAt: AT('09:00') }));
    await insert(env, makeAppointment({ status: 'COMPLETED', completedAt: AT('09:30') }));
    await insert(env, makeAppointment({ status: 'NO_SHOW', noShowAt: AT('10:00') }));
    await insert(env, makeAppointment({ status: 'CANCELLED', cancelledAt: AT('10:30') }));

    const r = await report.getDailyReport(TEST_DATE);
    expect(r.rates).toEqual({ completed: 50, noShow: 25, cancelled: 25 });
    expect(r.counts.COMPLETED).toBe(2);
    expect(r.stillOpen).toBe(0);
  });

  it('una giornata senza pratiche non divide per zero', async () => {
    const { report } = setup();
    const r = await report.getDailyReport(TEST_DATE);
    expect(r.total).toBe(0);
    expect(r.rates).toEqual({ completed: 0, noShow: 0, cancelled: 0 });
    expect(r.averageWait).toEqual({ minutes: null, sampleSize: 0 });
    expect(r.longestWaitMinutes).toBeNull();
  });

  it('le pratiche ancora aperte sono contate a parte', async () => {
    const { env, report } = setup();
    await insert(env, makeAppointment());
    await insert(env, makeAppointment({ status: 'SKIPPED' }));
    await insert(env, makeAppointment({ status: 'IN_PROGRESS', takenAt: AT('09:00') }));
    await insert(env, makeAppointment({ status: 'COMPLETED', completedAt: AT('09:10') }));

    const r = await report.getDailyReport(TEST_DATE);
    expect(r.stillOpen).toBe(3);
  });
});

describe('DailyReportService: esportazione CSV', () => {
  it('intestazione in italiano, una riga per pratica, separatore punto e virgola', async () => {
    const { env, report } = setup();
    const a = await insert(
      env,
      makeAppointment({
        scheduledAt: AT('08:00'),
        takenAt: AT('08:10'),
        completedAt: AT('08:40'),
        status: 'COMPLETED',
      }),
    );

    const csv = await report.buildDailyCsv(TEST_DATE);
    const righe = csv.split('\r\n');
    expect(righe[0]).toContain('Codice;Orario agenda');
    expect(righe[0]).toContain('Attesa (min);Lavorazione (min);Foto;Note');
    expect(righe).toHaveLength(2);

    const colonne = righe[1]?.split(';') ?? [];
    expect(colonne[0]).toBe(a.code);
    expect(colonne[3]).toBe(a.vehicle.plate);
    expect(colonne[10]).toBe('Completata');
    // Minuti con la virgola decimale: è un file che si apre in Excel italiano.
    expect(colonne[14]).toBe('10,0');
    expect(colonne[15]).toBe('30,0');
  });

  it('protegge i campi che contengono il separatore o le virgolette', async () => {
    const { env, report } = setup();
    await insert(
      env,
      makeAppointment({ notes: 'Graffio; paraurti "posteriore"', status: 'COMPLETED' }),
    );

    const csv = await report.buildDailyCsv(TEST_DATE);
    expect(csv).toContain('"Graffio; paraurti ""posteriore"""');
    // Le virgolette raddoppiate non spezzano il numero di righe.
    expect(csv.split('\r\n')).toHaveLength(2);
  });

  it('conta le foto dell’ispezione e propone un nome file con la data', async () => {
    const { env, report } = setup();
    const a = await insert(env, makeAppointment({ status: 'COMPLETED' }));
    await env.media.insert({
      id: 'media-1' as never,
      appointmentId: a.id,
      kind: 'PHOTO',
      category: 'FRONT',
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
      storageKey: `${TEST_DATE}/${a.code}/front-media-1.jpg`,
      thumbnailKey: null,
      capturedByOperatorId: 'op-advisor-1' as never,
      capturedAt: AT('09:00'),
      note: null,
    });

    const csv = await report.buildDailyCsv(TEST_DATE);
    const colonne = csv.split('\r\n')[1]?.split(';') ?? [];
    expect(colonne[16]).toBe('1');
    expect(report.csvFileName(TEST_DATE)).toBe(`accettazione-${TEST_DATE}.csv`);
  });

  it('una giornata vuota produce comunque il file con la sola intestazione', async () => {
    const { report } = setup();
    const csv = await report.buildDailyCsv(TEST_DATE);
    expect(csv.split('\r\n')).toHaveLength(1);
    expect(csv.startsWith('Codice;')).toBe(true);
  });
});
