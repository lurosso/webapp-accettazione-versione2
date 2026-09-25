// «Le mie prenotazioni»: Infinity assegna ogni prenotazione a un accettatore
// (accettatore_prenotazione → o_operai), l'account dell'operatore porta la sua matricola, e in
// dashboard l'accettatore vede per prime le prenotazioni che il gestionale gli ha dato.
// Il dato si prova lungo tutto il percorso: adapter, mapper, sync, coda, rotta, amministrazione.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InfinityAdvisorDirectory } from '@/application/admin/InfinityAdvisorDirectory';
import { OperatorAdminService } from '@/application/admin/OperatorAdminService';
import { CodeGenerator } from '@/application/queue/CodeGenerator';
import { QueueService } from '@/application/queue/QueueService';
import { SyncService } from '@/application/sync/SyncService';
import { GET as coda } from '@/app/api/v1/queue/route';
import { SESSION_COOKIE_NAME } from '@/config/auth';
import {
  createContainer,
  resetContainerForTests,
  setContainerForTests,
  type Container,
} from '@/config/container';
import { asDeskId, asOperatorId } from '@/domain/ids';
import { ok } from '@/domain/result';
import { normalizeAdvisorCode, sameAdvisorCode } from '@/domain/value-objects/advisor-code';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import { InMemoryStore } from '@/repositories/in-memory/InMemoryStore';
import type { InfinityAgendaDto, InfinityAppointmentDto } from '@/services/dto/infinity.dto';
import type { HealthStatus } from '@/services/interfaces/common';
import type { IInfinityService } from '@/services/interfaces/IInfinityService';
import { NoopLogger } from '@/services/mocks/ConsoleLogger';
import { buildTestEnv, TEST_DATE, TestClock } from '../helpers/fixtures';

/** Infinity finto che restituisce l'agenda che gli si dà. */
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

function dto(n: number, overrides: Partial<InfinityAppointmentDto> = {}): InfinityAppointmentDto {
  return {
    externalId: `PRE-${n}`,
    scheduledAt: `${TEST_DATE}T06:${String(n).padStart(2, '0')}:00.000Z`,
    brandCode: 'FIAT',
    plate: `AB${String(100 + n)}CD`,
    vin: null,
    vehicleModel: 'Panda 1.0 Hybrid',
    customer: {
      externalId: `C-${n}`,
      firstName: 'Mario',
      lastName: `Rossi ${n}`,
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

function setupSync(appointments: InfinityAppointmentDto[]) {
  const env = buildTestEnv();
  const infinity = new InfinityFisso(appointments, () => env.clock.nowIso());
  const sync = new SyncService({
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
  const queue = new QueueService({
    appointments: env.appointments,
    referenceData: env.referenceData,
    operators: env.operators,
    notifications: env.notifications,
    crmNotifier: env.crmNotifier,
    eventBus: env.eventBus,
    clock: env.clock,
    ids: env.ids,
    logger: env.logger,
  });
  return { env, infinity, sync, queue };
}

describe('Matricola dell’accettatore', () => {
  it('si confronta ripulita: spazi del CHAR di Infinity e maiuscole non contano', () => {
    expect(normalizeAdvisorCode(' 102  ')).toBe('102');
    expect(normalizeAdvisorCode('ab1')).toBe('AB1');
    expect(normalizeAdvisorCode('   ')).toBeNull();
    expect(normalizeAdvisorCode(undefined)).toBeNull();
    expect(sameAdvisorCode('102 ', '102')).toBe(true);
    expect(sameAdvisorCode(null, null)).toBe(false);
    expect(sameAdvisorCode('102', '024')).toBe(false);
  });
});

describe('Dal planning alla pratica', () => {
  it('la sync porta matricola e nome dell’accettatore assegnato sulla pratica', async () => {
    const { env, sync } = setupSync([
      dto(1, { advisorCode: '102 ', advisorName: 'GIORGIO VERDI' }),
      dto(2, { advisorCode: null, advisorName: null }),
      dto(3),
    ]);
    await sync.runDailySync(TEST_DATE, 'BOOTSTRAP');
    const tutte = await env.appointments.listByDate(TEST_DATE);
    const per = (ref: string) => tutte.find((a) => a.externalRef === ref)?.assignedAdvisor;
    expect(per('PRE-1')).toEqual({ code: '102', name: 'GIORGIO VERDI' });
    expect(per('PRE-2')).toBeNull();
    // Un DTO senza i campi (versione precedente dell'adapter o del mock) vale «non indicato».
    expect(per('PRE-3')).toBeNull();
  });

  it('se Infinity riassegna una prenotazione ancora in attesa, la sync la sposta', async () => {
    const { env, infinity, sync } = setupSync([
      dto(1, { advisorCode: '102', advisorName: 'GIORGIO VERDI' }),
    ]);
    await sync.runDailySync(TEST_DATE, 'BOOTSTRAP');
    infinity.appointments = [dto(1, { advisorCode: '103', advisorName: 'SILVIA NERI' })];
    await sync.runDailySync(TEST_DATE, 'MANUAL');
    const [a] = await env.appointments.listByDate(TEST_DATE);
    expect(a?.assignedAdvisor).toEqual({ code: '103', name: 'SILVIA NERI' });
  });

  it('arriva anche sulle pratiche già in carico o completate, senza cambiarne la versione', async () => {
    const { env, infinity, sync } = setupSync([dto(1), dto(2)]);
    await sync.runDailySync(TEST_DATE, 'BOOTSTRAP');
    const [uno, due] = await env.appointments.listByDate(TEST_DATE);
    if (uno === undefined || due === undefined) {
      throw new Error('pratiche mancanti');
    }
    const inCarico = await env.appointments.update({ ...uno, status: 'IN_PROGRESS' }, uno.version);
    const completata = await env.appointments.update({ ...due, status: 'COMPLETED' }, due.version);
    if (!inCarico.ok || !completata.ok) {
      throw new Error('aggiornamento di prova fallito');
    }
    infinity.appointments = [
      dto(1, { advisorCode: '102', advisorName: 'GIORGIO VERDI' }),
      dto(2, { advisorCode: '103', advisorName: 'SILVIA NERI' }),
    ];
    await sync.runDailySync(TEST_DATE, 'MANUAL');
    const dopo1 = await env.appointments.findById(uno.id);
    const dopo2 = await env.appointments.findById(due.id);
    expect(dopo1?.assignedAdvisor?.code).toBe('102');
    expect(dopo2?.assignedAdvisor?.code).toBe('103');
    // Nessun conflitto per chi sta lavorando la pratica: la versione è quella di prima.
    expect(dopo1?.version).toBe(inCarico.value.version);
    expect(dopo2?.version).toBe(completata.value.version);
    // E un update successivo con una copia vecchia non riporta indietro l'accettatore.
    const ancora = await env.appointments.update(
      { ...inCarico.value, notes: 'nota' },
      inCarico.value.version,
    );
    expect(ancora.ok && ancora.value.assignedAdvisor?.code).toBe('102');
  });
});

describe('La coda per accettatore', () => {
  it('«le mie» sono quelle assegnate alla matricola, su qualunque sportello', async () => {
    const { env, sync, queue } = setupSync([
      dto(1, { advisorCode: '102', brandCode: 'FIAT' }),
      dto(2, { advisorCode: '102', brandCode: 'PEUGEOT' }),
      dto(3, { advisorCode: '103', brandCode: 'FIAT' }),
      dto(4),
    ]);
    await sync.runDailySync(TEST_DATE, 'BOOTSTRAP');
    const mie = await queue.getQueue({
      businessDate: TEST_DATE,
      deskId: asDeskId('desk-s1'),
      globalView: false,
      advisorCode: ' 102',
    });
    expect(mie.map((r) => r.appointment.externalRef)).toEqual(['PRE-1', 'PRE-2']);
    // Senza matricola la coda resta quella di sempre (sportello o tutti).
    const tutte = await queue.getQueue({ businessDate: TEST_DATE, deskId: null, globalView: true });
    expect(tutte).toHaveLength(4);
    void env;
  });
});

describe('Amministrazione: collegare l’account alla matricola', () => {
  function setupAdmin() {
    const env = buildTestEnv();
    const admin = new OperatorAdminService({
      operators: env.operators,
      referenceData: env.referenceData,
      ids: env.ids,
      logger: env.logger,
    });
    return { env, admin };
  }
  const AMMINISTRATORE = { operatorId: asOperatorId('op-admin') };

  it('si imposta, si ripulisce e si toglie; due account non possono avere la stessa', async () => {
    const { admin } = setupAdmin();
    const impostata = await admin.update(
      asOperatorId('op-advisor-1'),
      { infinityAdvisorCode: ' 201 ' },
      AMMINISTRATORE,
    );
    expect(impostata.ok && impostata.value.infinityAdvisorCode).toBe('201');

    const doppia = await admin.update(
      asOperatorId('op-advisor-2'),
      { infinityAdvisorCode: '201' },
      AMMINISTRATORE,
    );
    expect(!doppia.ok && doppia.error.code).toBe('VALIDATION');
    expect(!doppia.ok && doppia.error.message).toContain('Mario Rossi');

    const sbagliata = await admin.update(
      asOperatorId('op-advisor-2'),
      { infinityAdvisorCode: 'ciao mondo!' },
      AMMINISTRATORE,
    );
    expect(!sbagliata.ok && sbagliata.error.code).toBe('VALIDATION');

    const tolta = await admin.update(
      asOperatorId('op-advisor-1'),
      { infinityAdvisorCode: null },
      AMMINISTRATORE,
    );
    expect(tolta.ok && tolta.value.infinityAdvisorCode).toBeNull();

    // Senza il campo, la matricola resta com'era.
    await admin.update(
      asOperatorId('op-advisor-1'),
      { infinityAdvisorCode: '201' },
      AMMINISTRATORE,
    );
    const nome = await admin.update(
      asOperatorId('op-advisor-1'),
      { displayName: 'Mario Rossi Senior' },
      AMMINISTRATORE,
    );
    expect(nome.ok && nome.value.infinityAdvisorCode).toBe('201');
  });

  it('l’elenco delle matricole viste nel planning dice nome, prenotazioni e account collegato', async () => {
    const { env, sync } = setupSync([
      dto(1, { advisorCode: '101', advisorName: 'MARIO ROSSI' }),
      dto(2, { advisorCode: '101', advisorName: 'MARIO ROSSI' }),
      dto(3, { advisorCode: '555', advisorName: 'NUOVO ACCETTATORE' }),
    ]);
    await sync.runDailySync(TEST_DATE, 'BOOTSTRAP');
    const elenco = await new InfinityAdvisorDirectory({
      appointments: env.appointments,
      operators: env.operators,
      clock: env.clock,
    }).list();
    const mario = elenco.find((a) => a.code === '101');
    expect(mario).toMatchObject({ name: 'MARIO ROSSI', appointments: 2 });
    // Nel seed demo Mario Rossi ha la matricola 101: è già collegato.
    expect(mario?.linkedTo?.displayName).toBe('Mario Rossi');
    expect(elenco.find((a) => a.code === '555')?.linkedTo).toBeNull();
  });
});

describe('GET /api/v1/queue?view=mine', () => {
  let container: Container;
  const cookie: Record<string, string> = {};

  async function accedi(username: string, workstationId: string): Promise<string> {
    const r = await container.authService.login({ username, password: 'demo', workstationId });
    if (!r.ok) {
      throw new Error(`login ${username}: ${r.error.message}`);
    }
    return `${SESSION_COOKIE_NAME}=${r.value.token}`;
  }

  function richiesta(chi: string, view: string): NextRequest {
    return new NextRequest(`http://officina.local/api/v1/queue?view=${view}`, {
      headers: { cookie: cookie[chi] ?? '' },
    });
  }

  beforeAll(async () => {
    container = createContainer({
      env: {
        messagingStandby: true,
        spokiProvider: 'mock',
        smsProvider: 'mock',
        crmProvider: 'mock',
        infinityProvider: 'mock',
        repositoryProvider: 'memory',
        mediaStorageProvider: 'memory',
        mockLatencyMs: 0,
      },
      clock: new TestClock('2026-09-10T08:00:00.000Z'),
      logger: new NoopLogger(),
      store: InMemoryStore.createIsolated(),
      sessionSecret: 's'.repeat(40),
    });
    setContainerForTests(container);
    await container.syncService.runDailySync(TEST_DATE, 'BOOTSTRAP');
    cookie['mario'] = await accedi('mario.rossi', 'ws-p2');
    cookie['admin'] = await accedi('admin', 'ws-p4');
  });

  afterAll(() => {
    resetContainerForTests();
  });

  it('l’accettatore collegato vede solo le sue, con il conteggio per la scheda', async () => {
    const r = await coda(richiesta('mario', 'mine'));
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      view: string;
      mine: { linked: boolean; openCount: number };
      rows: { appointment: { assignedAdvisor: { code: string } | null } }[];
    };
    expect(body.view).toBe('mine');
    expect(body.mine.linked).toBe(true);
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.rows.every((row) => row.appointment.assignedAdvisor?.code === '101')).toBe(true);
    expect(body.mine.openCount).toBe(body.rows.length);
  });

  it('un account senza matricola non vede niente in «le mie» e lo sa', async () => {
    const r = await coda(richiesta('admin', 'mine'));
    const body = (await r.json()) as { mine: { linked: boolean }; rows: unknown[] };
    expect(body.mine.linked).toBe(false);
    expect(body.rows).toEqual([]);
  });
});
