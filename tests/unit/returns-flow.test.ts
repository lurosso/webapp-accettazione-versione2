import { describe, expect, it } from 'vitest';
import { CodeGenerator } from '@/application/queue/CodeGenerator';
import { SyncService } from '@/application/sync/SyncService';
import { ok } from '@/domain/result';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import type { PlateNumber } from '@/domain/value-objects/plate';
import {
  parseLineRows,
  parsePhoneRows,
  parseTempoRows,
  toAgendaDto,
  toPlanningRecords,
  type OdbcRow,
} from '@/infrastructure/adapters/infinity';
import type { InfinityAgendaDto, InfinityAppointmentDto } from '@/services/dto/infinity.dto';
import type { HealthStatus } from '@/services/interfaces/common';
import type { IInfinityService } from '@/services/interfaces/IInfinityService';
import { buildTestEnv, makeAppointment, TEST_DATE } from '../helpers/fixtures';

/** Riga `L` della procedura: commessa in consegna oggi, senza prenotazione (id_documento nullo). */
const RIGA_RICONSEGNA: OdbcRow = {
  genere_doc: 'L',
  id_documento: null,
  id_commessa: 91561,
  tipo_riga: 'R',
  data_prenotazione: null,
  ora_prenotazione: null,
  data_prevcons: new Date('2026-09-16T00:00:00.000Z'),
  ora_prevcons: '15:00:00',
  anno: 2026,
  tipo_doc: 'LO01',
  tipo_doc_descr: 'Commessa officina Bari',
  sede: '01',
  id_cliente_generico: null,
  num_doc: 266151,
  data_doc: new Date('2026-09-15T00:00:00.000Z'),
  id_cliente: 390321,
  cliente: 'VERDI LUIGI',
  cliente_cognome: 'VERDI',
  cliente_nome: 'LUIGI',
  cons_privacy: 'S',
  pref_invio_notifiche: null,
  indirizzo_notifiche: null,
  tel_cliente1: null,
  tel_cliente2: null,
  tel_cliente3: null,
  codice_contatto: null,
  contatto: null,
  contatto_cellulare: null,
  accettatore_cod: '103',
  accettatore_nome: 'MICHELE GIGLIONE',
  tipo_intervento: '2',
  tipo_intervento_descr: 'Postvendita',
  confermato: null,
  flag_clienteinsala: 0,
  id_stato_doc: 13,
  stato_doc_descr: 'Collaudato',
  order_id: null,
  note_doc: null,
  note_cliente: null,
  proprietario: 390321,
  closed: 0,
  deleted: null,
  pren_closed: null,
  ordine_lavoro: null,
  data_modifica: null,
  data_creazione: null,
  id_veicolo: 28611,
  targa: 'GS620TE',
  telaio: 'VYCUPHPX0R4218844',
  cod_marca: '70',
  marca_descr: 'LANCIA',
  cod_modello: '4281R10',
  modello_descr: 'Ypsilon 1.2',
  modello_comm: null,
};

class InfinityFisso implements IInfinityService {
  readonly name = 'INFINITY' as const;
  constructor(
    public appointments: InfinityAppointmentDto[],
    private readonly nowIso: () => IsoDateTime,
  ) {}
  async fetchDailyAgenda() {
    const agenda: InfinityAgendaDto = {
      businessDate: TEST_DATE,
      fetchedAt: this.nowIso(),
      partial: false,
      appointments: this.appointments,
    };
    return ok(agenda);
  }
  async fetchAppointmentByPlate() {
    return ok(null);
  }
  async healthCheck(): Promise<HealthStatus> {
    return {
      provider: 'INFINITY',
      status: 'UP',
      checkedAt: this.nowIso(),
      latencyMs: 0,
      detail: null,
      implementation: 'mock',
    };
  }
}

function dto(overrides: Partial<InfinityAppointmentDto>): InfinityAppointmentDto {
  return {
    externalId: 'PRE-1',
    scheduledAt: `${TEST_DATE}T06:30:00.000Z`,
    brandCode: 'FIAT',
    plate: 'AB123CD',
    vin: null,
    vehicleModel: 'Panda',
    customer: {
      externalId: 'C-1',
      firstName: 'Mario',
      lastName: 'Rossi',
      phone: '+393331234560',
      email: null,
      whatsappOptIn: null,
    },
    serviceDescription: 'TAGLIANDO',
    deskCode: null,
    cancelled: false,
    closedInDms: false,
    flow: 'INTAKE',
    workOrderRef: null,
    updatedAt: `${TEST_DATE}T05:00:00.000Z`,
    ...overrides,
  };
}

const RICONSEGNA = dto({
  externalId: 'COM-91561',
  scheduledAt: `${TEST_DATE}T13:00:00.000Z`,
  plate: 'GS620TE',
  brandCode: 'LANCIA',
  flow: 'RETURN',
  workOrderRef: 'LO01 266151/2026',
  serviceDescription: 'Riconsegna veicolo · Collaudato',
  customer: {
    externalId: 'C-2',
    firstName: 'Luigi',
    lastName: 'Verdi',
    phone: '+393331234561',
    email: null,
    whatsappOptIn: null,
  },
});

function setupSync(appointments: InfinityAppointmentDto[]) {
  const env = buildTestEnv();
  const infinity = new InfinityFisso(appointments, () => env.clock.nowIso());
  const service = new SyncService({
    infinity,
    appointments: env.appointments,
    syncRuns: env.syncRuns,
    referenceData: env.referenceData,
    codeGenerator: new CodeGenerator(env.appointments, { sitePrefix: 'F', scope: 'SITE' }),
    eventBus: env.eventBus,
    clock: env.clock,
    ids: env.ids,
    logger: env.logger,
    timeZone: 'Europe/Rome',
  });
  return { env, infinity, service };
}

describe('Riconsegne (flusso RETURN): adapter Infinity', () => {
  it('una commessa in consegna senza prenotazione diventa una riconsegna con id COM-, commessa e stato', () => {
    const records = toPlanningRecords({
      rows: [RIGA_RICONSEGNA],
      lines: parseLineRows([]),
      tempi: parseTempoRows([]),
      phones: parsePhoneRows([]),
      businessDate: TEST_DATE,
      includeWorkOrders: true,
    });
    expect(records).toHaveLength(1);
    expect(records[0]?.flusso).toBe('RICONSEGNA');
    expect(records[0]?.oraPrenotazione).toBe('15:00');
    const agenda = toAgendaDto(records, TEST_DATE, 'Europe/Rome');
    const [r] = agenda.appointments;
    expect(r?.externalId).toBe('COM-91561');
    expect(r?.flow).toBe('RETURN');
    expect(r?.workOrderRef).toBe('LO01 266151/2026');
    expect(r?.serviceDescription).toContain('Riconsegna');
    expect(r?.serviceDescription).toContain('Collaudato');
    expect(r?.closedInDms).toBe(false);
    // Consegnata in Infinity (stato 17): nasce già riconsegnata.
    const consegnata = toAgendaDto(
      toPlanningRecords({
        rows: [{ ...RIGA_RICONSEGNA, id_stato_doc: 17, stato_doc_descr: 'Fatturato/consegnato' }],
        lines: [],
        tempi: [],
        phones: [],
        businessDate: TEST_DATE,
        includeWorkOrders: true,
      }),
      TEST_DATE,
      'Europe/Rome',
    );
    expect(consegnata.appointments[0]?.closedInDms).toBe(true);
    // Senza includeWorkOrders le riconsegne restano fuori, come prima.
    expect(
      toPlanningRecords({
        rows: [RIGA_RICONSEGNA],
        lines: [],
        tempi: [],
        phones: [],
        businessDate: TEST_DATE,
        includeWorkOrders: false,
      }),
    ).toHaveLength(0);
  });
});

describe('Riconsegne (flusso RETURN): sync, repository e coda', () => {
  it('nascono con codice R001, fuori dalla coda: la lista giornaliera le mostra solo su richiesta', async () => {
    const { env, service } = setupSync([dto({}), RICONSEGNA]);
    const run = await service.runDailySync(TEST_DATE, 'BOOTSTRAP');
    expect(run.status).toBe('SUCCESS');
    expect(run.counters.created).toBe(2);

    const coda = await env.appointments.listByDate(TEST_DATE);
    expect(coda.map((a) => a.code)).toEqual(['F001']);
    const riconsegne = await env.appointments.listByDate(TEST_DATE, { flow: 'RETURN' });
    expect(riconsegne).toHaveLength(1);
    expect(riconsegne[0]?.code).toBe('R001');
    expect(riconsegne[0]?.flow).toBe('RETURN');
    expect(riconsegne[0]?.workOrderRef).toBe('LO01 266151/2026');
    expect(await env.appointments.listByDate(TEST_DATE, { flow: 'ALL' })).toHaveLength(2);

    // Promemoria (solo WAITING del flusso predefinito) e portale (targa di oggi) non le vedono.
    const candidati = await env.appointments.listByDate(TEST_DATE, { statuses: ['WAITING'] });
    expect(candidati.map((a) => a.code)).toEqual(['F001']);
    expect(await env.appointments.findByPlate('GS620TE' as PlateNumber, TEST_DATE)).toEqual([]);

    // La seconda sync le riconosce (non le ricrea) e le chiude quando Infinity le segna consegnate.
    env.clock.advance(60_000);
    const seconda = await service.runDailySync(TEST_DATE, 'MANUAL');
    expect(seconda.counters.created).toBe(0);
    expect(seconda.counters.unchanged).toBe(2);
  });

  it('la storia di una targa attraversa le giornate e i flussi, dalla più recente', async () => {
    const env = buildTestEnv();
    const targa = 'ZZ999ZZ' as PlateNumber;
    for (const [giornata, code] of [
      ['2026-09-01', 'F004'],
      ['2026-09-10', 'F007'],
      ['2026-09-05', 'F002'],
    ] as const) {
      const base = makeAppointment({ businessDate: giornata as never, code: code as never });
      await env.appointments.insert({ ...base, vehicle: { ...base.vehicle, plate: targa } });
    }
    const altra = makeAppointment();
    await env.appointments.insert(altra);

    const storia = await env.appointments.searchHistory({ plate: 'zz 999 zz' }, 10);
    expect(storia.map((a) => a.businessDate)).toEqual(['2026-09-10', '2026-09-05', '2026-09-01']);
    expect(await env.appointments.searchHistory({ code: 'F007' }, 10)).toHaveLength(1);
    expect(await env.appointments.searchHistory({ plate: 'ZZ999ZZ' }, 2)).toHaveLength(2);
  });
});
