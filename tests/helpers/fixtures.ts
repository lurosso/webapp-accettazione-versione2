// Fixture condivise dai test: orologio fisso, repository in-memory isolati e pratiche di esempio.
import { buildSeedData, type SeedData } from '@/config/seed';
import type { Appointment } from '@/domain/entities/appointment';
import {
  asAppointmentId,
  asBrandId,
  asCustomerId,
  asDeskId,
  asVehicleId,
  type AppointmentId,
} from '@/domain/ids';
import type { IsoDate, IsoDateTime } from '@/domain/value-objects/iso-date';
import { isoDateTime } from '@/domain/value-objects/iso-date';
import type { PhoneE164 } from '@/domain/value-objects/phone';
import type { PlateNumber } from '@/domain/value-objects/plate';
import { formatQueueCode } from '@/domain/value-objects/queue-code';
import { InMemoryAppointmentRepository } from '@/repositories/in-memory/InMemoryAppointmentRepository';
import { InMemoryOperatorRepository } from '@/repositories/in-memory/InMemoryOperatorRepository';
import { InMemoryReferenceDataRepository } from '@/repositories/in-memory/InMemoryReferenceDataRepository';
import { InMemoryStore } from '@/repositories/in-memory/InMemoryStore';
import { InMemorySyncRunRepository } from '@/repositories/in-memory/InMemorySyncRunRepository';
import type { IClock } from '@/services/interfaces/IClock';
import { NoopLogger } from '@/services/mocks/ConsoleLogger';
import { InProcessEventBus } from '@/services/mocks/InProcessEventBus';
import { SequentialIdGenerator } from '@/services/mocks/SequentialIdGenerator';

/** Giornata operativa usata da tutti i test. */
export const TEST_DATE = '2026-09-10' as IsoDate;

/** Orologio fisso e avanzabile (mai `new Date()` nel codice sotto test). */
export class TestClock implements IClock {
  private current: Date;

  constructor(iso = '2026-09-10T08:00:00.000Z') {
    this.current = new Date(iso);
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  nowIso(): IsoDateTime {
    return isoDateTime(this.current);
  }

  today(): IsoDate {
    return TEST_DATE;
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** Ambiente di test isolato: store con seed, repository, bus eventi, id sequenziali, logger muto. */
export function buildTestEnv(clock = new TestClock()) {
  const store = InMemoryStore.createIsolated();
  const seed: SeedData = buildSeedData();
  store.seedReferenceData(seed);
  return {
    clock,
    store,
    seed,
    appointments: new InMemoryAppointmentRepository(store, clock),
    referenceData: new InMemoryReferenceDataRepository(store),
    operators: new InMemoryOperatorRepository(store),
    syncRuns: new InMemorySyncRunRepository(store),
    eventBus: new InProcessEventBus(),
    ids: new SequentialIdGenerator('t'),
    logger: new NoopLogger(),
  };
}

let counter = 0;

/** Pratica WAITING di esempio (Fiat, sportello S1), con override puntuali. */
export function makeAppointment(overrides: Partial<Appointment> = {}): Appointment {
  counter += 1;
  const id: AppointmentId = asAppointmentId(`app-${counter}`);
  const now = '2026-09-10T05:00:00.000Z' as IsoDateTime;
  return {
    id,
    externalRef: `INF-${counter}`,
    source: 'INFINITY',
    businessDate: TEST_DATE,
    scheduledAt: `2026-09-10T0${6 + (counter % 3)}:00:00.000Z` as IsoDateTime,
    code: formatQueueCode('F', counter),
    sequence: counter,
    brandId: asBrandId('brand-fiat'),
    deskId: asDeskId('desk-s1'),
    customer: {
      id: asCustomerId(`cust-${counter}`),
      externalRef: null,
      firstName: 'Mario',
      lastName: `Rossi ${counter}`,
      phone: '+393331234560' as PhoneE164,
      email: null,
      whatsappOptIn: true,
    },
    vehicle: {
      id: asVehicleId(`veh-${counter}`),
      plate: `AB${String(100 + counter).padStart(3, '0')}CD` as PlateNumber,
      brandId: asBrandId('brand-fiat'),
      model: '500',
      vin: null,
    },
    serviceDescription: 'Tagliando',
    status: 'WAITING',
    bayId: null,
    operatorId: null,
    skipCount: 0,
    notes: null,
    takenAt: null,
    skippedAt: null,
    completedAt: null,
    noShowAt: null,
    cancelledAt: null,
    lastSyncRunId: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
