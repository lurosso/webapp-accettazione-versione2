// Gli sportelli visti dall'amministratore: a chi sono assegnati e cosa ci sta succedendo.
import { describe, expect, it } from 'vitest';
import { AssistanceService } from '@/application/admin/AssistanceService';
import { LocalAuthService } from '@/application/auth/LocalAuthService';
import { QueueService, type ActionContext } from '@/application/queue/QueueService';
import { asBayId, asOperatorId, asWorkstationId } from '@/domain/ids';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import { buildTestEnv, makeAppointment, TEST_DATE } from '../helpers/fixtures';

function setup() {
  const env = buildTestEnv();
  const queueService = new QueueService({
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
  const assistance = new AssistanceService({
    appointments: env.appointments,
    referenceData: env.referenceData,
    operators: env.operators,
    claims: env.workstationClaims,
    clock: env.clock,
  });
  const ctx: ActionContext = {
    operatorId: asOperatorId('op-advisor-1'),
    workstationId: asWorkstationId('ws-p1'),
    correlationId: 'corr-assistenza',
  };
  return { env, queueService, assistance, ctx };
}

describe('AssistanceService: i quattro sportelli per l’amministratore', () => {
  it('a officina ferma sono tutti liberi e senza nessuno collegato', async () => {
    const { assistance } = setup();
    const vista = await assistance.overview(TEST_DATE);

    expect(vista.bays.map((b) => b.code)).toEqual(['A', 'B', 'C', 'D']);
    for (const bay of vista.bays) {
      expect(bay.assignedOperatorName).toBeNull();
      expect(bay.occupiedBy).toBeNull();
      // L'area per marchio serve al monitoraggio: A e B stanno su FCA, C e D su PSA.
      expect(bay.deskCode).not.toBeNull();
      expect(bay.workstationId).not.toBeNull();
    }
    expect(vista.bays[0]?.deskCode).toBe('FCA');
    expect(vista.bays[3]?.deskCode).toBe('PSA');
  });

  it('dice chi è collegato anche quando lo sportello non ha pratiche in corso', async () => {
    const { env, assistance } = setup();
    await env.workstationClaims.upsert({
      workstationId: asWorkstationId('ws-p2'),
      operatorId: asOperatorId('op-advisor-1'),
      operatorName: 'Mario Rossi',
      claimedAt: env.clock.nowIso(),
      expiresAt: '2099-01-01T00:00:00.000Z' as IsoDateTime,
    });

    const sportelloB = (await assistance.overview(TEST_DATE)).bays.find((b) => b.code === 'B');
    expect(sportelloB?.assignedOperatorName).toBe('Mario Rossi');
    expect(sportelloB?.assignedSince).not.toBeNull();
    // Collegato ma fermo: è libero, aspetta il prossimo cliente.
    expect(sportelloB?.occupiedBy).toBeNull();
  });

  it('con una pratica in carico dice targa, codice e da quanto', async () => {
    const { env, queueService, assistance, ctx } = setup();
    const inserita = await env.appointments.insert(makeAppointment());
    if (!inserita.ok) {
      throw new Error('insert');
    }
    await queueService.takeInCharge(
      { appointmentId: inserita.value.id, expectedVersion: 1, bayId: asBayId('bay-c3') },
      ctx,
    );
    env.clock.advance(12 * 60_000);

    const sportelloC = (await assistance.overview(TEST_DATE)).bays.find((b) => b.code === 'C');
    expect(sportelloC?.occupiedBy?.code).toBe(inserita.value.code);
    expect(sportelloC?.occupiedBy?.plate).toBe(inserita.value.vehicle.plate);
    expect(sportelloC?.occupiedBy?.operatorName).toBe('Mario Rossi');
    expect(sportelloC?.occupiedBy?.minutesInProgress).toBe(12);
    // Nessuno è collegato a quella postazione: la pratica è lì, l'operatore no.
    expect(sportelloC?.assignedOperatorName).toBeNull();
  });
});

describe('AssistanceService: sgancio dello sportello (fine turno dimenticata)', () => {
  it('libera il posto e lascia in carico la pratica che ci stava lavorando', async () => {
    const { env, queueService, assistance, ctx } = setup();
    // Mario è collegato allo sportello A e ha una pratica in lavorazione.
    await env.workstationClaims.upsert({
      workstationId: asWorkstationId('ws-p1'),
      operatorId: asOperatorId('op-advisor-1'),
      operatorName: 'Mario Rossi',
      claimedAt: env.clock.nowIso(),
      expiresAt: '2099-01-01T00:00:00.000Z' as IsoDateTime,
    });
    const inserita = await env.appointments.insert(makeAppointment());
    if (!inserita.ok) {
      throw new Error('insert');
    }
    await queueService.takeInCharge(
      { appointmentId: inserita.value.id, expectedVersion: 1, bayId: asBayId('bay-c1') },
      ctx,
    );

    const esito = await assistance.eject(asWorkstationId('ws-p1'));
    expect(esito.operatorName).toBe('Mario Rossi');
    // La pratica non si tocca: un veicolo accettato a metà non si chiude per una sessione.
    expect(esito.stillInProgressCode).toBe(inserita.value.code);
    expect((await env.appointments.findById(inserita.value.id))?.status).toBe('IN_PROGRESS');

    // Lo sportello risulta libero da subito: il collega del turno dopo può sedersi.
    const sportelloA = (await assistance.overview(TEST_DATE)).bays.find((b) => b.code === 'A');
    expect(sportelloA?.assignedOperatorName).toBeNull();
    expect(sportelloA?.occupiedBy?.code).toBe(inserita.value.code);
  });

  it('sganciare un posto già libero non è un errore', async () => {
    const { assistance } = setup();
    const esito = await assistance.eject(asWorkstationId('ws-p4'));
    expect(esito.operatorName).toBeNull();
    expect(esito.stillInProgressCode).toBeNull();
  });

  it('la sessione di chi è stato scollegato smette di valere', async () => {
    const { env } = setup();
    const auth = new LocalAuthService({
      operators: env.operators,
      referenceData: env.referenceData,
      claims: env.workstationClaims,
      clock: env.clock,
      logger: env.logger,
      secret: 'segreto-di-prova-lungo-almeno-trentadue-caratteri',
      ttlHours: 8,
    });
    const assistance = new AssistanceService({
      appointments: env.appointments,
      referenceData: env.referenceData,
      operators: env.operators,
      claims: env.workstationClaims,
      clock: env.clock,
    });

    const login = await auth.login({
      username: 'mario.rossi',
      password: 'demo',
      workstationId: 'ws-p2',
    });
    expect(login.ok).toBe(true);
    if (!login.ok) {
      return;
    }
    expect((await auth.verify(login.value.token)).ok).toBe(true);

    await assistance.eject(asWorkstationId('ws-p2'));

    const dopo = await auth.verify(login.value.token);
    expect(dopo.ok).toBe(false);
    if (!dopo.ok) {
      expect(dopo.error.message).toContain('sportello è stato liberato');
    }
  });
});

describe('AssistanceService: il polso della fila', () => {
  it('conta le auto in fila, quelle annunciate e le attese di adesso', async () => {
    const { env, queueService, assistance, ctx } = setup();
    const uno = await env.appointments.insert(makeAppointment());
    const due = await env.appointments.insert(makeAppointment());
    const tre = await env.appointments.insert(makeAppointment());
    if (!uno.ok || !due.ok || !tre.ok) {
      throw new Error('insert');
    }
    // Due si sono annunciati a distanza di dieci minuti, uno non ancora.
    await env.appointments.update(
      { ...uno.value, customerArrivedAt: env.clock.nowIso() },
      uno.value.version,
    );
    env.clock.advance(10 * 60_000);
    await env.appointments.update(
      { ...due.value, customerArrivedAt: env.clock.nowIso() },
      due.value.version,
    );
    env.clock.advance(10 * 60_000);

    const live = (await assistance.overview(TEST_DATE)).live;
    expect(live.inQueue).toBe(3);
    expect(live.announced).toBe(2);
    // Venti minuti e dieci: media quindici, massimo venti.
    expect(live.averageWaitMinutes).toBe(15);
    expect(live.longestWaitMinutes).toBe(20);
    expect(live.inProgress).toBe(0);

    // Presa in carico: esce dalla fila ed entra fra le pratiche agli sportelli.
    const corrente = await env.appointments.findById(uno.value.id);
    await queueService.takeInCharge(
      { appointmentId: uno.value.id, expectedVersion: corrente?.version ?? 1, bayId: null },
      ctx,
    );
    const dopo = (await assistance.overview(TEST_DATE)).live;
    expect(dopo.inQueue).toBe(2);
    expect(dopo.inProgress).toBe(1);
    expect(dopo.announced).toBe(1);
  });

  it('senza nessuno annunciato la media resta vuota invece di inventare un numero', async () => {
    const { env, assistance } = setup();
    await env.appointments.insert(makeAppointment());

    const live = (await assistance.overview(TEST_DATE)).live;
    expect(live.inQueue).toBe(1);
    expect(live.announced).toBe(0);
    expect(live.averageWaitMinutes).toBeNull();
    expect(live.longestWaitMinutes).toBeNull();
  });
});
