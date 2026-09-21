// Portale cliente: stato della pratica (tappe, coda, appuntamento), accesso per targa o token,
// targhe non valide o sconosciute, pratiche concluse, auto-segnalazione del ritardo.
import { describe, expect, it } from 'vitest';
import { CustomerPortalService, portalStageOf } from '@/application/portal/CustomerPortalService';
import { createPortalTokenFactory } from '@/application/portal/portal-token';
import { LATE_GRACE_MINUTES } from '@/config/constants';
import { isDueWithinGrace, isLate, type Appointment } from '@/domain/entities/appointment';
import type { DomainEvent } from '@/domain/events';
import { asBayId, asBrandId, asDeskId, asOperatorId } from '@/domain/ids';
import type { IsoDate, IsoDateTime } from '@/domain/value-objects/iso-date';
import {
  aheadCountMessage,
  concludedMessage,
  PORTAL_STAGES,
  stageLabel,
  statusMessage,
} from '@/modules/customer-portal/status-messages';
import { buildTemplateVars } from '@/application/notifications/templates';
import { buildTestEnv, makeAppointment, TEST_DATE, TestClock } from '../helpers/fixtures';

const AT = (hhmm: string) => `2026-09-10T${hhmm}:00.000Z` as IsoDateTime;
const IERI = '2026-09-09' as IsoDate;

function setup(clock = new TestClock('2026-09-10T07:00:00.000Z')) {
  const env = buildTestEnv(clock);
  const tokens = createPortalTokenFactory('segreto-di-prova-abbastanza-lungo-per-i-test');
  const eventi: DomainEvent[] = [];
  env.eventBus.subscribe((e) => {
    eventi.push(e);
  });
  const service = new CustomerPortalService({
    appointments: env.appointments,
    referenceData: env.referenceData,
    operators: env.operators,
    eventBus: env.eventBus,
    clock,
    ids: env.ids,
    logger: env.logger,
    tokens,
    siteName: 'Autoclub Group Bari',
  });
  return { env, clock, tokens, service, eventi };
}

async function insert(env: ReturnType<typeof buildTestEnv>, a: Appointment): Promise<Appointment> {
  const r = await env.appointments.insert(a);
  if (!r.ok) {
    throw new Error(r.error.message);
  }
  return r.value;
}

describe('Portale: rendering dello stato', () => {
  it('le tre tappe e le etichette sono quelle del percorso del cliente', () => {
    expect(PORTAL_STAGES.map((s) => s.label)).toEqual([
      'In attesa',
      'In accettazione',
      'Accettazione conclusa',
    ]);
    expect(portalStageOf('WAITING')).toBe(1);
    expect(portalStageOf('SKIPPED')).toBe(1);
    expect(portalStageOf('IN_PROGRESS')).toBe(2);
    expect(portalStageOf('COMPLETED')).toBe(3);
    expect(portalStageOf('NO_SHOW')).toBe(1);
    expect(stageLabel(2)).toBe('In accettazione');
    expect(statusMessage('IN_PROGRESS', 'C').detail).toContain('sportello C');
    expect(statusMessage('COMPLETED', null).headline).toBe('Accettazione conclusa');
    expect(statusMessage('COMPLETED', null).detail).toContain('può ripartire');
    expect(statusMessage('COMPLETED', null).detail).not.toContain('ritiro');
    expect(concludedMessage('COMPLETED').headline).toBe('Pratica conclusa');
    expect(aheadCountMessage(0)).toBe('Il prossimo turno è il suo');
    expect(aheadCountMessage(3)).toBe('Ci sono 3 auto prima di lei');
  });

  it('in attesa: tappa 1, clienti davanti dello stesso sportello, orario, sede e nessun accettatore', async () => {
    const { env, service } = setup();
    await insert(env, makeAppointment({ scheduledAt: AT('06:30') }));
    await insert(env, makeAppointment({ scheduledAt: AT('06:45'), status: 'SKIPPED' }));
    await insert(
      env,
      makeAppointment({
        scheduledAt: AT('06:00'),
        deskId: asDeskId('desk-s2'),
        brandId: asBrandId('brand-jeep'),
      }),
    );
    const mia = await insert(env, makeAppointment({ scheduledAt: AT('07:30') }));

    const r = await service.getStatus({ plate: mia.vehicle.plate });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    const v = r.value;
    expect(v.code).toBe(mia.code);
    expect(v.plate).toBe(mia.vehicle.plate);
    expect(v.stage).toBe(1);
    expect(v.status).toBe('WAITING');
    expect(v.aheadCount).toBe(2);
    // "Sei il numero 3 in attesa": i due davanti più se stesso. Fuori dalla coda la posizione
    // sparisce, perché chi è già allo sportello non sta più in fila.
    expect(v.queuePosition).toBe(3);
    expect(v.arrivedAt).toBeNull();
    expect(v.startedAt).toBeNull();
    expect(v.expectedTime).toBe(mia.scheduledAt);
    expect(v.siteName).toBe('Autoclub Group Bari');
    expect(v.deskName).toBe('Sportelli A e B');
    expect(v.operatorName).toBeNull();
    expect(v.lateNotice).toBeNull();
    expect(v.canReportDelay).toBe(true);
    expect(v.expired).toBe(false);
    // Nessun dato personale del cliente nella vista.
    expect(JSON.stringify(v)).not.toContain('Rossi');
    expect(JSON.stringify(v)).not.toContain('+39333');
  });

  it("in accettazione: tappa 2 con lo sportello e il nome dell'accettatore; conclusa: tappa 3 senza pulsante", async () => {
    const { env, service } = setup();
    const inCorso = await insert(
      env,
      makeAppointment({
        status: 'IN_PROGRESS',
        operatorId: asOperatorId('op-advisor-1'),
        bayId: asBayId('bay-c2'),
        takenAt: AT('06:50'),
      }),
    );
    const r = await service.getStatus({ plate: inCorso.vehicle.plate });
    expect(r.ok && r.value.stage).toBe(2);
    expect(r.ok && r.value.operatorName).toBe('Mario Rossi');
    expect(r.ok && r.value.bayCode).toBe('B');
    expect(r.ok && r.value.canReportDelay).toBe(false);
    expect(r.ok && r.value.queuePosition).toBeNull();
    // L'ora della chiamata allo sportello è quella che il cliente legge nella riga del tempo.
    expect(r.ok && r.value.startedAt).toBe(AT('06:50'));

    const completata = await insert(
      env,
      makeAppointment({ status: 'COMPLETED', completedAt: AT('06:55') }),
    );
    const c = await service.getStatus({ plate: completata.vehicle.plate });
    expect(c.ok && c.value.stage).toBe(3);
    expect(c.ok && c.value.expired).toBe(false);
    expect(c.ok && c.value.canReportDelay).toBe(false);
  });
});

describe('Portale: accesso per targa o token, targhe non valide e pratiche concluse', () => {
  it('il token del link identifica la pratica senza targa; un token sbagliato non apre nulla', async () => {
    const { env, service, tokens } = setup();
    const mia = await insert(env, makeAppointment({ scheduledAt: AT('07:30') }));
    const token = tokens.forAppointment(mia.id);
    expect(token).toMatch(/^[0-9a-f]{16}$/);
    expect(tokens.matches(mia.id, token.toUpperCase())).toBe(true);
    expect(tokens.matches(mia.id, 'ffffffffffff')).toBe(false);

    const perToken = await service.getStatus({ token });
    expect(perToken.ok && perToken.value.code).toBe(mia.code);

    const sbagliato = await service.getStatus({ token: 'ffffffffffff' });
    expect(!sbagliato.ok && sbagliato.error.code).toBe('NOT_FOUND');

    // Token sbagliato ma targa giusta: si prosegue per targa, come dal QR.
    const conTarga = await service.getStatus({ token: 'ffffffffffff', plate: mia.vehicle.plate });
    expect(conTarga.ok && conTarga.value.code).toBe(mia.code);
  });

  it('il link dei messaggi porta targa e token', async () => {
    const { env, tokens } = setup();
    const a = makeAppointment();
    const vars = buildTemplateVars(
      a,
      env.seed.brands[0]!,
      'Europe/Rome',
      'https://officina.example',
      tokens.forAppointment(a.id),
    );
    expect(vars.portalUrl).toBe(
      `https://officina.example/portal?targa=${a.vehicle.plate}&t=${tokens.forAppointment(a.id)}`,
    );
  });

  it('targa mancante o malformata → VALIDATION; targa sconosciuta → NOT_FOUND', async () => {
    const { service } = setup();
    const vuota = await service.getStatus({ plate: '' });
    expect(!vuota.ok && vuota.error.code).toBe('VALIDATION');
    const malformata = await service.getStatus({ plate: '!!!' });
    expect(!malformata.ok && malformata.error.code).toBe('VALIDATION');
    const sconosciuta = await service.getStatus({ plate: 'ZZ999ZZ' });
    expect(!sconosciuta.ok && sconosciuta.error.code).toBe('NOT_FOUND');
    expect(!sconosciuta.ok && sconosciuta.error.message).toContain('Targa non trovata');
  });

  it('una pratica di ieri conclusa da oltre 24 ore è "conclusa": nessuna coda, nessun pulsante', async () => {
    const { env, service } = setup(new TestClock('2026-09-10T15:00:00.000Z'));
    const ieri = await insert(
      env,
      makeAppointment({
        businessDate: IERI,
        scheduledAt: '2026-09-09T07:30:00.000Z' as IsoDateTime,
        status: 'COMPLETED',
        completedAt: '2026-09-09T08:10:00.000Z' as IsoDateTime,
      }),
    );
    const r = await service.getStatus({ plate: ieri.vehicle.plate });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.value.expired).toBe(true);
    expect(r.value.status).toBe('COMPLETED');
    expect(r.value.stage).toBe(3);
    expect(r.value.businessDate).toBe(IERI);
    expect(r.value.concludedAt).toBe('2026-09-09T08:10:00.000Z');
    expect(r.value.canReportDelay).toBe(false);
    expect(r.value.aheadCount).toBe(0);
  });

  it('una pratica di ieri conclusa da poche ore si legge ancora come completata, non come scaduta', async () => {
    const { env, service } = setup(new TestClock('2026-09-10T06:00:00.000Z'));
    const ieri = await insert(
      env,
      makeAppointment({
        businessDate: IERI,
        scheduledAt: '2026-09-09T16:30:00.000Z' as IsoDateTime,
        status: 'COMPLETED',
        completedAt: '2026-09-09T17:00:00.000Z' as IsoDateTime,
      }),
    );
    const r = await service.getStatus({ plate: ieri.vehicle.plate });
    expect(r.ok && r.value.expired).toBe(false);
    expect(r.ok && r.value.stage).toBe(3);
  });

  it('con la stessa targa oggi e ieri vince la pratica di oggi', async () => {
    const { env, service } = setup();
    const oggi = await insert(env, makeAppointment({ scheduledAt: AT('07:30') }));
    await insert(
      env,
      makeAppointment({
        businessDate: IERI,
        vehicle: { ...oggi.vehicle },
        status: 'COMPLETED',
        completedAt: '2026-09-09T08:00:00.000Z' as IsoDateTime,
      }),
    );
    const r = await service.getStatus({ plate: oggi.vehicle.plate });
    expect(r.ok && r.value.businessDate).toBe(TEST_DATE);
    expect(r.ok && r.value.expired).toBe(false);
  });
});

describe('Portale: auto-segnalazione "sto arrivando in ritardo (+10 min)"', () => {
  it("sposta l'arrivo atteso, pubblica l'evento con attore CUSTOMER e non cambia ordine né codice", async () => {
    const { env, service, eventi, clock } = setup(new TestClock('2026-09-10T07:20:00.000Z'));
    const davanti = await insert(env, makeAppointment({ scheduledAt: AT('07:15') }));
    const mia = await insert(env, makeAppointment({ scheduledAt: AT('07:30') }));
    const dietro = await insert(env, makeAppointment({ scheduledAt: AT('07:45') }));

    const r = await service.reportDelay({ plate: mia.vehicle.plate });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    // Arrivo atteso: orario dell'appuntamento (ancora futuro) + 10 minuti.
    expect(r.value.lateNotice).toEqual({
      at: clock.nowIso(),
      etaAt: AT('07:40'),
      minutes: 10,
    });
    expect(r.value.canReportDelay).toBe(false);
    expect(r.value.code).toBe(mia.code);
    expect(r.value.expectedTime).toBe(mia.scheduledAt); // l'ordine in coda non cambia

    const salvata = await env.appointments.findById(mia.id);
    expect(salvata?.customerLateNoticeAt).toBe(clock.nowIso());
    expect(salvata?.customerEtaAt).toBe(AT('07:40'));
    expect(salvata?.rescheduledAt).toBeNull();
    expect(salvata?.version).toBe(mia.version + 1);

    const evento = eventi.find((e) => e.type === 'CUSTOMER_LATE_NOTICE');
    expect(evento).toBeDefined();
    if (evento?.type === 'CUSTOMER_LATE_NOTICE') {
      expect(evento.appointmentId).toBe(mia.id);
      expect(evento.minutes).toBe(10);
      expect(evento.etaAt).toBe(AT('07:40'));
      expect(evento.actor.kind).toBe('CUSTOMER');
    }

    // Chi era davanti e chi era dietro restano dove erano.
    const posDietro = await service.getStatus({ plate: dietro.vehicle.plate });
    expect(posDietro.ok && posDietro.value.aheadCount).toBe(2);
    const posDavanti = await service.getStatus({ plate: davanti.vehicle.plate });
    expect(posDavanti.ok && posDavanti.value.aheadCount).toBe(0);
  });

  it("la dashboard non conta in ritardo chi ha avvisato, fino all'orario dichiarato", async () => {
    const { env, service } = setup(new TestClock('2026-09-10T07:35:00.000Z'));
    const mia = await insert(env, makeAppointment({ scheduledAt: AT('07:30') }));
    const r = await service.reportDelay({ plate: mia.vehicle.plate });
    expect(r.ok).toBe(true);
    const salvata = (await env.appointments.findById(mia.id))!;
    // Appuntamento alle 07:30 superato di 5 minuti, arrivo dichiarato alle 07:45.
    expect(salvata.customerEtaAt).toBe(AT('07:45'));
    expect(isLate(salvata, AT('07:50'), LATE_GRACE_MINUTES)).toBe(false);
    expect(isDueWithinGrace(salvata, AT('07:50'), LATE_GRACE_MINUTES)).toBe(true);
    expect(isLate(salvata, AT('07:56'), LATE_GRACE_MINUTES)).toBe(true);
    // Senza avviso sarebbe già in ritardo alle 07:41.
    expect(isLate(mia, AT('07:41'), LATE_GRACE_MINUTES)).toBe(true);
  });

  it('un secondo tocco entro il tempo minimo non duplica nulla; dopo, si può avvisare di nuovo', async () => {
    const clock = new TestClock('2026-09-10T07:20:00.000Z');
    const { env, service, eventi } = setup(clock);
    const mia = await insert(env, makeAppointment({ scheduledAt: AT('07:30') }));
    await service.reportDelay({ plate: mia.vehicle.plate });
    clock.advance(60_000);
    const secondo = await service.reportDelay({ plate: mia.vehicle.plate });
    expect(secondo.ok && secondo.value.canReportDelay).toBe(false);
    expect(eventi.filter((e) => e.type === 'CUSTOMER_LATE_NOTICE')).toHaveLength(1);

    clock.advance(5 * 60_000);
    const stato = await service.getStatus({ plate: mia.vehicle.plate });
    expect(stato.ok && stato.value.canReportDelay).toBe(true);
    const terzo = await service.reportDelay({ plate: mia.vehicle.plate });
    expect(terzo.ok).toBe(true);
    expect(eventi.filter((e) => e.type === 'CUSTOMER_LATE_NOTICE')).toHaveLength(2);
  });

  it('si può avvisare solo mentre si è in attesa oggi; i minuti hanno un intervallo sensato', async () => {
    const { env, service } = setup();
    const inCorso = await insert(env, makeAppointment({ status: 'IN_PROGRESS' }));
    const r = await service.reportDelay({ plate: inCorso.vehicle.plate });
    expect(!r.ok && r.error.code).toBe('INVALID_TRANSITION');

    const attesa = await insert(env, makeAppointment({ scheduledAt: AT('08:00') }));
    const troppo = await service.reportDelay({ plate: attesa.vehicle.plate }, 500);
    expect(!troppo.ok && troppo.error.code).toBe('VALIDATION');

    const sconosciuta = await service.reportDelay({ plate: 'ZZ999ZZ' });
    expect(!sconosciuta.ok && sconosciuta.error.code).toBe('NOT_FOUND');
  });
});

describe('Portale: "sono arrivato"', () => {
  it("annota l'ora, pubblica l'evento e non cambia il posto in coda", async () => {
    const { env, service, eventi } = setup();
    await insert(env, makeAppointment({ scheduledAt: AT('06:30') }));
    const mia = await insert(env, makeAppointment({ scheduledAt: AT('07:30') }));

    const r = await service.registerArrival({ plate: mia.vehicle.plate });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.value.registered).toBe(true);
    expect(r.value.status.arrivedAt).not.toBeNull();
    // La posizione non si tocca: davanti c'è ancora chi era prenotato prima.
    expect(r.value.status.queuePosition).toBe(2);
    expect(r.value.status.status).toBe('WAITING');

    const arrivo = eventi.find((e) => e.type === 'CUSTOMER_ARRIVED');
    expect(arrivo).toBeDefined();
    expect(arrivo?.actor.kind).toBe('CUSTOMER');
    if (arrivo?.type === 'CUSTOMER_ARRIVED') {
      expect(arrivo.channel).toBe('PORTAL');
    }
  });

  it('il secondo tocco non sposta l’ora e non pubblica un altro evento', async () => {
    const { env, clock, service, eventi } = setup();
    const mia = await insert(env, makeAppointment({ scheduledAt: AT('07:30') }));

    const primo = await service.registerArrival({ plate: mia.vehicle.plate });
    const ora = primo.ok ? primo.value.status.arrivedAt : null;
    clock.advance(4 * 60_000);
    const secondo = await service.registerArrival({ plate: mia.vehicle.plate });

    expect(secondo.ok && secondo.value.registered).toBe(false);
    expect(secondo.ok && secondo.value.status.arrivedAt).toBe(ora);
    expect(eventi.filter((e) => e.type === 'CUSTOMER_ARRIVED')).toHaveLength(1);
  });

  it('una pratica già allo sportello non viene toccata da un arrivo tardivo', async () => {
    const { env, service, eventi } = setup();
    const inCorso = await insert(
      env,
      makeAppointment({
        status: 'IN_PROGRESS',
        operatorId: asOperatorId('op-advisor-1'),
        bayId: asBayId('bay-c2'),
        takenAt: AT('06:50'),
      }),
    );

    const r = await service.registerArrival({ plate: inCorso.vehicle.plate });
    expect(r.ok && r.value.registered).toBe(false);
    expect(r.ok && r.value.status.arrivedAt).toBeNull();
    expect(eventi.filter((e) => e.type === 'CUSTOMER_ARRIVED')).toHaveLength(0);
  });
});
