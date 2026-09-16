import { describe, expect, it } from 'vitest';
import { CodeGenerator } from '@/application/queue/CodeGenerator';
import { CLOSED_IN_DMS_NOTE, SyncService } from '@/application/sync/SyncService';
import type { DomainEvent } from '@/domain/events';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import { ok } from '@/domain/result';
import type { InfinityAgendaDto, InfinityAppointmentDto } from '@/services/dto/infinity.dto';
import type { HealthStatus } from '@/services/interfaces/common';
import type { IInfinityService } from '@/services/interfaces/IInfinityService';
import { buildTestEnv, TEST_DATE } from '../helpers/fixtures';

/** Infinity finto che restituisce l'agenda che gli si dà: serve a pilotare `closedInDms`. */
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
    updatedAt: `${TEST_DATE}T05:00:00.000Z`,
    ...overrides,
  };
}

function setup(appointments: InfinityAppointmentDto[]) {
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

describe('Sync: prenotazioni già «Chiuse in ODL» in Infinity', () => {
  it('nascono COMPLETED con la nota, tengono il loro codice e non sono candidate ai promemoria', async () => {
    const { env, service } = setup([dto(1, { closedInDms: true }), dto(2)]);
    const run = await service.runDailySync(TEST_DATE, 'BOOTSTRAP');
    expect(run.status).toBe('SUCCESS');
    expect(run.counters.created).toBe(2);

    const tutte = await env.appointments.listByDate(TEST_DATE);
    const chiusa = tutte.find((a) => a.externalRef === 'PRE-1');
    const aperta = tutte.find((a) => a.externalRef === 'PRE-2');
    expect(chiusa?.status).toBe('COMPLETED');
    expect(chiusa?.completedAt).toBe(env.clock.nowIso());
    expect(chiusa?.notes).toBe(CLOSED_IN_DMS_NOTE);
    expect(chiusa?.code).toBe('F001'); // il codice segue l'ordine dell'agenda, chiusa o no
    expect(chiusa?.operatorId).toBeNull();
    expect(aperta?.status).toBe('WAITING');

    // I promemoria scelgono solo chi è in attesa: la pratica chiusa in ODL non riceve nulla.
    const candidati = await env.appointments.listByDate(TEST_DATE, { statuses: ['WAITING'] });
    expect(candidati.map((a) => a.externalRef)).toEqual(['PRE-2']);
  });

  it('una pratica in attesa che Infinity chiude in ODL a metà giornata passa a COMPLETED con evento; una in carico non si tocca', async () => {
    const { env, infinity, service } = setup([dto(1), dto(2), dto(3)]);
    await service.runDailySync(TEST_DATE, 'BOOTSTRAP');
    const prima = await env.appointments.listByDate(TEST_DATE);
    const inCarico = prima.find((a) => a.externalRef === 'PRE-3')!;
    await env.appointments.update(
      { ...inCarico, status: 'IN_PROGRESS', takenAt: env.clock.nowIso() },
      inCarico.version,
    );

    const eventi: DomainEvent[] = [];
    env.eventBus.subscribe((e) => eventi.push(e));
    env.clock.advance(60_000);
    infinity.appointments = [dto(1, { closedInDms: true }), dto(2), dto(3, { closedInDms: true })];
    const seconda = await service.runDailySync(TEST_DATE, 'MANUAL');
    expect(seconda.status).toBe('SUCCESS');
    expect(seconda.counters.updated).toBe(1);
    expect(seconda.counters.cancelled).toBe(0);

    const dopo = await env.appointments.listByDate(TEST_DATE);
    expect(dopo.find((a) => a.externalRef === 'PRE-1')?.status).toBe('COMPLETED');
    expect(dopo.find((a) => a.externalRef === 'PRE-1')?.notes).toContain(CLOSED_IN_DMS_NOTE);
    expect(dopo.find((a) => a.externalRef === 'PRE-2')?.status).toBe('WAITING');
    expect(dopo.find((a) => a.externalRef === 'PRE-3')?.status).toBe('IN_PROGRESS');
    const cambio = eventi.find(
      (e) => e.type === 'APPOINTMENT_STATUS_CHANGED' && e.to === 'COMPLETED',
    );
    expect(cambio).toBeDefined();
    if (cambio !== undefined && cambio.type === 'APPOINTMENT_STATUS_CHANGED') {
      expect(cambio.from).toBe('WAITING');
      expect(cambio.actor.kind).toBe('SYSTEM');
    }
  });

  it('una sync infragiornaliera non segna mai assenti: le pratiche in attesa con orario passato restano in coda', async () => {
    const { env, service } = setup([dto(1), dto(2)]);
    await service.runDailySync(TEST_DATE, 'BOOTSTRAP');
    env.clock.advance(4 * 60 * 60_000); // quattro ore dopo, orari abbondantemente passati
    const seconda = await service.runDailySync(TEST_DATE, 'SCHEDULED');
    expect(seconda.status).toBe('SUCCESS');
    const tutte = await env.appointments.listByDate(TEST_DATE);
    expect(tutte.map((a) => a.status)).toEqual(['WAITING', 'WAITING']);
    expect(tutte.every((a) => a.noShowAt === null)).toBe(true);
  });
});
