import { describe, expect, it } from 'vitest';
import { CodeGenerator } from '@/application/queue/CodeGenerator';
import { ManualIntakeService, splitCustomerName } from '@/application/queue/ManualIntakeService';
import type { ActionContext } from '@/application/queue/QueueService';
import type { DomainEvent } from '@/domain/events';
import { asOperatorId, asWorkstationId } from '@/domain/ids';
import { formatQueueCode } from '@/domain/value-objects/queue-code';
import { buildTestEnv, makeAppointment, TEST_DATE } from '../helpers/fixtures';

function setup() {
  const env = buildTestEnv();
  const codeGenerator = new CodeGenerator(env.appointments, { sitePrefix: 'F', scope: 'SITE' });
  const service = new ManualIntakeService({
    appointments: env.appointments,
    referenceData: env.referenceData,
    codeGenerator,
    eventBus: env.eventBus,
    clock: env.clock,
    ids: env.ids,
    logger: env.logger,
  });
  const eventi: DomainEvent[] = [];
  env.eventBus.subscribe((e) => {
    eventi.push(e);
  });
  const ctx: ActionContext = {
    operatorId: asOperatorId('op-advisor-1'),
    workstationId: asWorkstationId('ws-p1'),
    correlationId: 'corr-intake',
  };
  return { env, service, ctx, eventi };
}

describe('splitCustomerName', () => {
  it('separa nome e cognome; una parola sola è il cognome', () => {
    expect(splitCustomerName('Mario Rossi')).toEqual({ firstName: 'Mario', lastName: 'Rossi' });
    expect(splitCustomerName('  Anna Maria  De Luca ')).toEqual({
      firstName: 'Anna',
      lastName: 'Maria De Luca',
    });
    expect(splitCustomerName('Rossi')).toEqual({ firstName: '', lastName: 'Rossi' });
  });
});

describe('ManualIntakeService: cliente senza appuntamento', () => {
  it('crea la pratica in coda oggi con il prossimo codice, targa e telefono normalizzati', async () => {
    const { service, ctx, eventi } = setup();
    const r = await service.create(
      {
        plate: ' ab 123 cd ',
        customerName: 'Mario Rossi',
        phone: '333 123 4567',
        brandId: 'brand-fiat',
        deskId: null,
        serviceDescription: '  Rumore anteriore ',
        whatsappOptIn: true,
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    const a = r.value;
    expect(a.status).toBe('WAITING');
    expect(a.source).toBe('MANUAL');
    expect(a.externalRef).toBeNull();
    expect(a.businessDate).toBe(TEST_DATE);
    expect(a.code).toBe('F001');
    expect(a.vehicle.plate).toBe('AB123CD');
    expect(a.customer.firstName).toBe('Mario');
    expect(a.customer.lastName).toBe('Rossi');
    expect(a.customer.phone).toBe('+393331234567');
    expect(a.customer.whatsappOptIn).toBe(true);
    expect(a.serviceDescription).toBe('Rumore anteriore');
    // Lo sportello è quello che serve il marchio (Fiat → S1).
    expect(a.deskId).toBe('desk-s1');
    // L'orario atteso è adesso: si mette in coda dietro a chi era prenotato prima.
    expect(a.scheduledAt).toBe(a.createdAt);
    expect(a.autoClosedAt).toBeNull();

    // Stesso evento della sync: la policy dei messaggi manda la conferma con il codice.
    const creato = eventi.find((e) => e.type === 'APPOINTMENT_CREATED');
    expect(creato).toBeDefined();
    expect(creato).toMatchObject({ source: 'MANUAL', actor: { kind: 'OPERATOR' } });
  });

  it('continua la numerazione della giornata dopo le pratiche della sync', async () => {
    const { env, service, ctx } = setup();
    await env.appointments.reserveNextSequence(TEST_DATE, 'F');
    await env.appointments.reserveNextSequence(TEST_DATE, 'F');
    const r = await service.create(
      {
        plate: 'CD456EF',
        customerName: 'Luca Bianchi',
        phone: null,
        brandId: 'brand-jeep',
        deskId: null,
        serviceDescription: null,
        whatsappOptIn: false,
      },
      ctx,
    );
    expect(r.ok && r.value.code).toBe('F003');
    expect(r.ok && r.value.deskId).toBe('desk-s2');
    expect(r.ok && r.value.customer.phone).toBeNull();
  });

  it('rifiuta targa non valida, nome mancante, telefono non valido e marca sconosciuta', async () => {
    const { service, ctx } = setup();
    const base = {
      plate: 'AB123CD',
      customerName: 'Mario Rossi',
      phone: null,
      brandId: 'brand-fiat',
      deskId: null,
      serviceDescription: null,
      whatsappOptIn: true,
    };
    expect((await service.create({ ...base, plate: '!!' }, ctx)).ok).toBe(false);
    expect((await service.create({ ...base, customerName: ' ' }, ctx)).ok).toBe(false);
    expect((await service.create({ ...base, phone: 'abc' }, ctx)).ok).toBe(false);
    expect((await service.create({ ...base, brandId: 'brand-tesla' }, ctx)).ok).toBe(false);
    expect((await service.create({ ...base, deskId: 'desk-inesistente' }, ctx)).ok).toBe(false);
  });

  it('non inserisce due volte una targa ancora in coda, ma accetta una targa già completata', async () => {
    const { env, service, ctx } = setup();
    // Codici alti per le pratiche di contorno: il contatore della giornata parte da F001.
    const inCoda = await env.appointments.insert(
      makeAppointment({ code: formatQueueCode('F', 901), sequence: 901 }),
    );
    if (!inCoda.ok) {
      throw new Error('fixture');
    }
    const doppia = await service.create(
      {
        plate: inCoda.value.vehicle.plate,
        customerName: 'Mario Rossi',
        phone: null,
        brandId: 'brand-fiat',
        deskId: null,
        serviceDescription: null,
        whatsappOptIn: true,
      },
      ctx,
    );
    expect(doppia.ok).toBe(false);
    if (!doppia.ok) {
      expect(doppia.error.code).toBe('VALIDATION');
      expect(doppia.error.message).toContain(inCoda.value.code);
    }

    const chiusa = await env.appointments.insert(
      makeAppointment({
        code: formatQueueCode('F', 902),
        sequence: 902,
        status: 'COMPLETED',
        completedAt: env.clock.nowIso(),
      }),
    );
    if (!chiusa.ok) {
      throw new Error('fixture');
    }
    const ritorno = await service.create(
      {
        plate: chiusa.value.vehicle.plate,
        customerName: 'Mario Rossi',
        phone: null,
        brandId: 'brand-fiat',
        deskId: null,
        serviceDescription: 'È tornato con un altro problema',
        whatsappOptIn: true,
      },
      ctx,
    );
    expect(ritorno.ok).toBe(true);
  });
});
