// Riconsegna prevista del veicolo (M8-T53-S01): data e ora che Infinity scrive sul documento
// (`data_prevcons`/`ora_prevcons`) arrivano fino alla pratica, perché la conferma dell'accettazione
// («📅 Conferma Accettazione») le dice al cliente. Come l'accettatore assegnato, la sync le aggiorna
// anche su pratiche già in carico senza toccarne la versione, e una copia vecchia non le riporta
// indietro.
import { describe, expect, it } from 'vitest';
import { CodeGenerator } from '@/application/queue/CodeGenerator';
import { SyncService } from '@/application/sync/SyncService';
import { ok } from '@/domain/result';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import type { InfinityAgendaDto, InfinityAppointmentDto } from '@/services/dto/infinity.dto';
import type { HealthStatus } from '@/services/interfaces/common';
import type { IInfinityService } from '@/services/interfaces/IInfinityService';
import { buildTestEnv, TEST_DATE } from '../helpers/fixtures';

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

function setup(appointments: InfinityAppointmentDto[]) {
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
  return { env, infinity, sync };
}

describe('Riconsegna prevista da Infinity', () => {
  it('arriva sulla pratica; senza giorno valido non c’è, con un’ora strana resta solo il giorno', async () => {
    const { env, sync } = setup([
      dto(1, { expectedDeliveryDate: '2026-09-11', expectedDeliveryTime: '17:30' }),
      dto(2, { expectedDeliveryDate: null, expectedDeliveryTime: '17:30' }),
      dto(3, { expectedDeliveryDate: '2026-09-10', expectedDeliveryTime: '25:00' }),
      dto(4),
    ]);
    await sync.runDailySync(TEST_DATE, 'BOOTSTRAP');
    const per = async (ref: string) =>
      (await env.appointments.listByDate(TEST_DATE)).find((a) => a.externalRef === ref)
        ?.expectedDelivery;
    expect(await per('PRE-1')).toEqual({ date: '2026-09-11', time: '17:30' });
    expect(await per('PRE-2')).toBeNull();
    expect(await per('PRE-3')).toEqual({ date: '2026-09-10', time: null });
    expect(await per('PRE-4')).toBeNull();
  });

  it('se Infinity la sposta a veicolo già in carico, la sync la aggiorna senza cambiare la versione', async () => {
    const { env, infinity, sync } = setup([
      dto(1, { expectedDeliveryDate: '2026-09-10', expectedDeliveryTime: '17:00' }),
    ]);
    await sync.runDailySync(TEST_DATE, 'BOOTSTRAP');
    const [pratica] = await env.appointments.listByDate(TEST_DATE);
    if (pratica === undefined) {
      throw new Error('pratica mancante');
    }
    const inCarico = await env.appointments.update(
      { ...pratica, status: 'IN_PROGRESS' },
      pratica.version,
    );
    if (!inCarico.ok) {
      throw new Error('aggiornamento di prova fallito');
    }
    infinity.appointments = [
      dto(1, { expectedDeliveryDate: '2026-09-12', expectedDeliveryTime: '12:00' }),
    ];
    await sync.runDailySync(TEST_DATE, 'MANUAL');
    const dopo = await env.appointments.findById(pratica.id);
    expect(dopo?.expectedDelivery).toEqual({ date: '2026-09-12', time: '12:00' });
    expect(dopo?.version).toBe(inCarico.value.version);
    // Una copia vecchia della pratica non riporta indietro la riconsegna.
    const ancora = await env.appointments.update(
      { ...inCarico.value, notes: 'nota' },
      inCarico.value.version,
    );
    expect(ancora.ok && ancora.value.expectedDelivery).toEqual({
      date: '2026-09-12',
      time: '12:00',
    });
  });
});
