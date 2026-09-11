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
import { NotificationOrchestrator } from '@/application/notifications/NotificationOrchestrator';
import { InMemoryAppointmentRepository } from '@/repositories/in-memory/InMemoryAppointmentRepository';
import { InMemoryNotificationRepository } from '@/repositories/in-memory/InMemoryNotificationRepository';
import { InMemoryOperatorRepository } from '@/repositories/in-memory/InMemoryOperatorRepository';
import { InMemoryReferenceDataRepository } from '@/repositories/in-memory/InMemoryReferenceDataRepository';
import { InMemoryStore } from '@/repositories/in-memory/InMemoryStore';
import { InMemorySyncRunRepository } from '@/repositories/in-memory/InMemorySyncRunRepository';
import type { IClock } from '@/services/interfaces/IClock';
import { MOCK_PHONE_RULES } from '@/services/interfaces/mock-config';
import { NoopLogger } from '@/services/mocks/ConsoleLogger';
import { InProcessEventBus } from '@/services/mocks/InProcessEventBus';
import { SequentialIdGenerator } from '@/services/mocks/SequentialIdGenerator';
import { SmsHostingServiceMock } from '@/services/mocks/SmsHostingServiceMock';
import { SpokiServiceMock } from '@/services/mocks/SpokiServiceMock';

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

/**
 * Ambiente di test isolato: store con seed, repository, bus eventi, id sequenziali, logger muto
 * e il modulo comunicazioni già cablato con i mock (latenza a zero, esiti deterministici).
 */
export function buildTestEnv(clock = new TestClock()) {
  const store = InMemoryStore.createIsolated();
  const seed: SeedData = buildSeedData();
  store.seedReferenceData(seed);
  const ids = new SequentialIdGenerator('t');
  const logger = new NoopLogger();
  const eventBus = new InProcessEventBus();
  const notifications = new InMemoryNotificationRepository(store);

  // Mock dei provider con la regola dell'ultima cifra del telefono: 9 → WhatsApp rifiutato,
  // 99 → falliscono entrambi i canali. Nessuna latenza e nessun ritardo di consegna, così
  // l'esito del fallback è immediato e i test restano deterministici.
  const spoki = new SpokiServiceMock(
    {
      failSuffix: MOCK_PHONE_RULES.whatsappInvalid,
      failureRate: null,
      mode: 'ok',
      latencyMs: 0,
      deliveryDelayMs: 0,
      seed: 'test-spoki',
    },
    { clock, ids, logger },
  );
  const smsHosting = new SmsHostingServiceMock(
    {
      failSuffix: MOCK_PHONE_RULES.bothChannelsFail,
      failureRate: null,
      mode: 'ok',
      latencyMs: 0,
      initialCredits: 500,
    },
    { clock, ids, logger },
  );
  const orchestrator = new NotificationOrchestrator({
    spoki,
    smsHosting,
    notifications,
    clock,
    ids,
    logger,
    eventBus,
    timeZone: 'Europe/Rome',
  });

  return {
    clock,
    store,
    seed,
    appointments: new InMemoryAppointmentRepository(store, clock),
    referenceData: new InMemoryReferenceDataRepository(store),
    operators: new InMemoryOperatorRepository(store),
    syncRuns: new InMemorySyncRunRepository(store),
    notifications,
    spoki,
    smsHosting,
    orchestrator,
    eventBus,
    ids,
    logger,
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
