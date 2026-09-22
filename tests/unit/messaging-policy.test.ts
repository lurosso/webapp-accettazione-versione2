import { describe, expect, it } from 'vitest';
import { CustomerMessagingPolicy } from '@/application/notifications/CustomerMessagingPolicy';
import type { Appointment } from '@/domain/entities/appointment';
import type { DomainEventActor, DomainEventPayload, NewDomainEvent } from '@/domain/events';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import type { ILogger } from '@/services/interfaces/ILogger';
import { buildTestEnv, makeAppointment } from '../helpers/fixtures';

/** Logger che conserva gli errori: la policy non lancia mai, quindi qui si vede cosa è andato storto. */
function recordingLogger(errori: string[]): ILogger {
  const l: ILogger = {
    child: () => l,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: (msg, ctx) => {
      errori.push(msg + ' ' + JSON.stringify(ctx ?? {}));
    },
  };
  return l;
}

/**
 * Policy con esecuzione controllata: i lavori rimandati finiscono in una lista e si eseguono a
 * comando, così si verifica sia il comportamento sia il fatto che nulla succede dentro `publish`.
 */
function setup(options: { readonly enabled?: boolean } = {}) {
  const env = buildTestEnv();
  const rimandati: (() => void)[] = [];
  const errori: string[] = [];
  const policy = new CustomerMessagingPolicy({
    eventBus: env.eventBus,
    appointments: env.appointments,
    referenceData: env.referenceData,
    orchestrator: env.orchestrator,
    ids: env.ids,
    logger: recordingLogger(errori),
    enabled: options.enabled ?? true,
    turnApproachingAhead: 2,
    defer: (work) => rimandati.push(work),
  });
  policy.start();
  const esegui = async (): Promise<void> => {
    while (rimandati.length > 0) {
      rimandati.shift()?.();
    }
    await policy.flush();
  };
  return { env, policy, rimandati, esegui, errori };
}

const AT = (hhmm: string): IsoDateTime => `2026-09-10T${hhmm}:00.000Z` as IsoDateTime;

async function insert(env: ReturnType<typeof buildTestEnv>, a: Appointment): Promise<Appointment> {
  const r = await env.appointments.insert(a);
  if (!r.ok) {
    throw new Error(r.error.message);
  }
  return r.value;
}

function evento(
  env: ReturnType<typeof buildTestEnv>,
  // `Omit` su un'unione terrebbe solo i campi comuni: si dichiara il payload per esteso.
  payload: DomainEventPayload & { readonly actor: DomainEventActor },
): void {
  env.eventBus.publish({
    id: env.ids.next(),
    occurredAt: env.clock.nowIso(),
    correlationId: 'corr-msg',
    ...payload,
  } as NewDomainEvent);
}

describe('CustomerMessagingPolicy', () => {
  it('una pratica inserita a mano riceve la conferma con il codice', async () => {
    const { env, esegui } = setup();
    const a = await insert(env, makeAppointment({ source: 'MANUAL' }));

    evento(env, {
      actor: { kind: 'OPERATOR', id: 'op-advisor-1' },
      type: 'APPOINTMENT_CREATED',
      appointmentId: a.id,
      source: 'MANUAL',
    });
    await esegui();

    const jobs = await env.notifications.listByAppointment(a.id);
    const conferma = jobs.find((j) => j.kind === 'BOOKING_CONFIRMED');
    expect(conferma).toBeDefined();
    expect(conferma?.renderedText).toContain(a.code);
    // Il finto Spoki con consegna immediata segna il messaggio come consegnato.
    expect(['SENT', 'DELIVERED']).toContain(conferma?.status);
  });

  it("le pratiche dell'agenda Infinity non ricevono la conferma: hanno il promemoria", async () => {
    const { env, esegui } = setup();
    const a = await insert(env, makeAppointment({ source: 'INFINITY' }));

    evento(env, {
      actor: { kind: 'SYSTEM', id: null },
      type: 'APPOINTMENT_CREATED',
      appointmentId: a.id,
      source: 'INFINITY',
    });
    await esegui();

    expect(await env.notifications.listByAppointment(a.id)).toHaveLength(0);
  });

  it("l'annullamento deciso da una persona avvisa il cliente", async () => {
    const { env, esegui } = setup();
    const a = await insert(env, makeAppointment({ status: 'CANCELLED', cancelledAt: AT('09:00') }));

    evento(env, {
      actor: { kind: 'OPERATOR', id: 'op-supervisor' },
      type: 'APPOINTMENT_STATUS_CHANGED',
      appointmentId: a.id,
      from: 'WAITING',
      to: 'CANCELLED',
      bayId: null,
    });
    await esegui();

    const jobs = await env.notifications.listByAppointment(a.id);
    expect(jobs.map((j) => j.kind)).toContain('APPOINTMENT_CANCELLED');
  });

  it("l'annullamento della chiusura automatica non manda messaggi alle 19:00", async () => {
    const { env, esegui } = setup();
    const a = await insert(env, makeAppointment({ status: 'CANCELLED', cancelledAt: AT('17:00') }));

    evento(env, {
      actor: { kind: 'SYSTEM', id: null },
      type: 'APPOINTMENT_STATUS_CHANGED',
      appointmentId: a.id,
      from: 'IN_PROGRESS',
      to: 'CANCELLED',
      bayId: null,
    });
    await esegui();

    expect(
      (await env.notifications.listByAppointment(a.id)).filter(
        (j) => j.kind === 'APPOINTMENT_CANCELLED',
      ),
    ).toHaveLength(0);
  });

  it("un cliente segnato assente da un operatore riceve l'avviso di annullamento", async () => {
    const { env, esegui } = setup();
    const a = await insert(env, makeAppointment({ status: 'NO_SHOW', noShowAt: AT('08:15') }));

    evento(env, {
      actor: { kind: 'OPERATOR', id: 'op-advisor-1' },
      type: 'APPOINTMENT_STATUS_CHANGED',
      appointmentId: a.id,
      from: 'WAITING',
      to: 'NO_SHOW',
      bayId: null,
    });
    await esegui();

    const jobs = await env.notifications.listByAppointment(a.id);
    expect(jobs.map((j) => j.kind)).toContain('APPOINTMENT_CANCELLED');
  });

  it('"il turno si avvicina" arriva a chi ha al massimo due pratiche davanti, una volta sola', async () => {
    const { env, esegui, errori } = setup();
    const inCoda: Appointment[] = [];
    for (let i = 0; i < 5; i += 1) {
      inCoda.push(
        await insert(
          env,
          makeAppointment({
            scheduledAt: AT(`${String(7 + i).padStart(2, '0')}:00`),
            sequence: 100 + i,
          }),
        ),
      );
    }
    // Il primo viene preso in carico: la fila si accorcia.
    const primo = inCoda[0]!;
    await env.appointments.update({ ...primo, status: 'IN_PROGRESS', takenAt: AT('07:05') }, 1);
    evento(env, {
      actor: { kind: 'OPERATOR', id: 'op-advisor-1' },
      type: 'APPOINTMENT_STATUS_CHANGED',
      appointmentId: primo.id,
      from: 'WAITING',
      to: 'IN_PROGRESS',
      bayId: null,
    });
    await esegui();

    const avvisati: string[] = [];
    for (const a of inCoda.slice(1)) {
      const jobs = await env.notifications.listByAppointment(a.id);
      if (jobs.some((j) => j.kind === 'TURN_APPROACHING')) {
        avvisati.push(a.code);
      }
    }
    expect(errori).toEqual([]);
    // Restano quattro in attesa: i primi tre hanno 0, 1 e 2 pratiche davanti; il quarto ne ha 3.
    expect(avvisati).toEqual(inCoda.slice(1, 4).map((a) => a.code));

    // Un altro cambio di stato non produce doppioni: l'idempotenza per giornata li ferma.
    evento(env, {
      actor: { kind: 'OPERATOR', id: 'op-advisor-1' },
      type: 'APPOINTMENT_STATUS_CHANGED',
      appointmentId: primo.id,
      from: 'IN_PROGRESS',
      to: 'COMPLETED',
      bayId: null,
    });
    await esegui();
    const secondo = await env.notifications.listByAppointment(inCoda[1]!.id);
    expect(secondo.filter((j) => j.kind === 'TURN_APPROACHING')).toHaveLength(1);
  });

  it('non lavora dentro la pubblicazione: chi pubblica non aspetta WhatsApp', async () => {
    const { env, rimandati } = setup();
    const a = await insert(env, makeAppointment({ source: 'MANUAL' }));

    evento(env, {
      actor: { kind: 'OPERATOR', id: 'op-advisor-1' },
      type: 'APPOINTMENT_CREATED',
      appointmentId: a.id,
      source: 'MANUAL',
    });

    // Subito dopo la pubblicazione il lavoro è solo in coda: nessun job ancora creato.
    expect(rimandati).toHaveLength(1);
    expect(await env.notifications.listByAppointment(a.id)).toHaveLength(0);
  });

  it('spenta dalla configurazione, non ascolta nulla', async () => {
    const { env, esegui } = setup({ enabled: false });
    const a = await insert(env, makeAppointment({ source: 'MANUAL' }));
    evento(env, {
      actor: { kind: 'OPERATOR', id: 'op-advisor-1' },
      type: 'APPOINTMENT_CREATED',
      appointmentId: a.id,
      source: 'MANUAL',
    });
    await esegui();
    expect(await env.notifications.listByAppointment(a.id)).toHaveLength(0);
  });

  it('alla presa in carico da parte di una persona parte il benvenuto con il link personale al portale', async () => {
    const { env, esegui } = setup();
    const a = await insert(env, makeAppointment({ status: 'IN_PROGRESS' }));

    evento(env, {
      actor: { kind: 'OPERATOR', id: 'op-advisor-1' },
      type: 'APPOINTMENT_STATUS_CHANGED',
      appointmentId: a.id,
      from: 'WAITING',
      to: 'IN_PROGRESS',
      bayId: null,
    });
    await esegui();

    const jobs = await env.notifications.listByAppointment(a.id);
    const benvenuto = jobs.find((j) => j.kind === 'CHECK_IN_STARTED');
    expect(benvenuto).toBeDefined();
    expect(benvenuto?.renderedText).toContain(a.vehicle.plate);
    expect(benvenuto?.renderedText).toContain('/portal?targa=');
    expect(['SENT', 'DELIVERED']).toContain(benvenuto?.status);
    // Lo stato WhatsApp arriva anche sulla pratica, per la coda e l'archivio.
    const pratica = await env.appointments.findById(a.id);
    expect(pratica?.whatsapp?.kind).toBe('CHECK_IN_STARTED');
    expect(['SENT', 'DELIVERED']).toContain(pratica?.whatsapp?.state);
    expect(pratica?.version).toBe(a.version);
  });

  it('a check-in completato da una persona parte il messaggio di fine accettazione', async () => {
    const { env, esegui } = setup();
    const a = await insert(env, makeAppointment({ status: 'COMPLETED' }));

    evento(env, {
      actor: { kind: 'OPERATOR', id: 'op-advisor-1' },
      type: 'APPOINTMENT_STATUS_CHANGED',
      appointmentId: a.id,
      from: 'IN_PROGRESS',
      to: 'COMPLETED',
      bayId: null,
    });
    await esegui();

    const jobs = await env.notifications.listByAppointment(a.id);
    const fine = jobs.find((j) => j.kind === 'CHECK_IN_COMPLETED');
    expect(fine?.renderedText).toContain(
      'Procedura di accettazione completata. Grazie per la visita, puoi proseguire!',
    );
  });

  it('la chiusura d’ufficio (attore di sistema) e le riconsegne non ricevono i messaggi del check-in', async () => {
    const { env, esegui } = setup();
    const chiusa = await insert(env, makeAppointment({ status: 'COMPLETED' }));
    const riconsegna = await insert(
      env,
      makeAppointment({ status: 'IN_PROGRESS', flow: 'RETURN' }),
    );

    evento(env, {
      actor: { kind: 'SYSTEM', id: null },
      type: 'APPOINTMENT_STATUS_CHANGED',
      appointmentId: chiusa.id,
      from: 'IN_PROGRESS',
      to: 'COMPLETED',
      bayId: null,
    });
    evento(env, {
      actor: { kind: 'OPERATOR', id: 'op-advisor-1' },
      type: 'APPOINTMENT_STATUS_CHANGED',
      appointmentId: riconsegna.id,
      from: 'WAITING',
      to: 'IN_PROGRESS',
      bayId: null,
    });
    await esegui();

    expect(await env.notifications.listByAppointment(chiusa.id)).toHaveLength(0);
    expect(await env.notifications.listByAppointment(riconsegna.id)).toHaveLength(0);
  });

  it('riaprire e riprendere in carico nello stesso giorno non manda un secondo benvenuto', async () => {
    const { env, esegui } = setup();
    const a = await insert(env, makeAppointment({ status: 'IN_PROGRESS' }));
    for (const from of ['WAITING', 'COMPLETED'] as const) {
      evento(env, {
        actor: { kind: 'OPERATOR', id: 'op-advisor-1' },
        type: 'APPOINTMENT_STATUS_CHANGED',
        appointmentId: a.id,
        from,
        to: 'IN_PROGRESS',
        bayId: null,
      });
      await esegui();
    }
    const benvenuti = (await env.notifications.listByAppointment(a.id)).filter(
      (j) => j.kind === 'CHECK_IN_STARTED',
    );
    expect(benvenuti).toHaveLength(1);
  });
});
