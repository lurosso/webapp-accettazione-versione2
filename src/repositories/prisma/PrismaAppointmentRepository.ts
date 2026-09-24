// Repository delle pratiche su SQLite. Stesso contratto dell'`InMemoryAppointmentRepository`, che
// resta il riferimento di comportamento: stessi errori, stessi messaggi, stesso ordinamento.
//
// Il cliente e il veicolo viaggiano in due colonne JSON, la targa ha una colonna sua perché è la
// ricerca dell'archivio. L'ordinamento della coda (orario effettivo, poi sequenza) si fa in
// memoria con lo stesso comparatore del dominio: le pratiche di una giornata sono qualche decina,
// e un `ORDER BY` che imiti `effectiveScheduleTime` sarebbe una seconda copia della regola.
//
// La concorrenza ottimistica passa dal database: `updateMany` con `id` E `version` attesa. Se non
// aggiorna nessuna riga, o la pratica non c'è più o l'ha cambiata un'altra postazione — e si
// rilegge per dire quale delle due, con la versione corrente, come fa la memoria.
import {
  isWhatsAppDeliveryState,
  type Appointment,
  type WhatsAppDelivery,
  type AssignedAdvisor,
} from '@/domain/entities/appointment';
import type { Customer } from '@/domain/entities/customer';
import type { Vehicle } from '@/domain/entities/vehicle';
import { domainError, type DomainError } from '@/domain/errors';
import type { AppointmentId } from '@/domain/ids';
import { err, ok, type Result } from '@/domain/result';
import type { IsoDate } from '@/domain/value-objects/iso-date';
import { normalizePlate, type PlateNumber } from '@/domain/value-objects/plate';
import { compareByScheduleThenSequence, type QueueCode } from '@/domain/value-objects/queue-code';
import type { Appointment as Row, Prisma } from '@/generated/prisma/client';
import type { IClock } from '@/services/interfaces/IClock';
import type {
  AppointmentFilter,
  AppointmentHistoryQuery,
  IAppointmentRepository,
} from '../interfaces/IAppointmentRepository';
import type { Db } from './client';
import { fromJson, toJson } from './json';

/** Dalla riga al dominio: i tipi marcati (id, codice, targa) tornano con un cast dichiarato. */
function toEntity(r: Row): Appointment {
  return {
    id: r.id as Appointment['id'],
    externalRef: r.externalRef,
    source: r.source as Appointment['source'],
    flow: r.flow as Appointment['flow'],
    workOrderRef: r.workOrderRef,
    businessDate: r.businessDate as IsoDate,
    scheduledAt: r.scheduledAt as Appointment['scheduledAt'],
    rescheduledAt: r.rescheduledAt as Appointment['rescheduledAt'],
    code: r.code as QueueCode,
    sequence: r.sequence,
    brandId: r.brandId as Appointment['brandId'],
    deskId: r.deskId as Appointment['deskId'],
    customer: fromJson<Customer>(r.customerJson, 'customerJson'),
    vehicle: fromJson<Vehicle>(r.vehicleJson, 'vehicleJson'),
    serviceDescription: r.serviceDescription,
    status: r.status as Appointment['status'],
    bayId: r.bayId as Appointment['bayId'],
    operatorId: r.operatorId as Appointment['operatorId'],
    skipCount: r.skipCount,
    notes: r.notes,
    takenAt: r.takenAt as Appointment['takenAt'],
    skippedAt: r.skippedAt as Appointment['skippedAt'],
    completedAt: r.completedAt as Appointment['completedAt'],
    noShowAt: r.noShowAt as Appointment['noShowAt'],
    cancelledAt: r.cancelledAt as Appointment['cancelledAt'],
    autoClosedAt: r.autoClosedAt as Appointment['autoClosedAt'],
    autoCloseConfirmedAt: r.autoCloseConfirmedAt as Appointment['autoCloseConfirmedAt'],
    customerLateNoticeAt: r.customerLateNoticeAt as Appointment['customerLateNoticeAt'],
    customerEtaAt: r.customerEtaAt as Appointment['customerEtaAt'],
    customerArrivedAt: r.customerArrivedAt as Appointment['customerArrivedAt'],
    orderClosedAt: r.orderClosedAt as Appointment['orderClosedAt'],
    legalHoldAt: r.legalHoldAt as Appointment['legalHoldAt'],
    legalHoldReason: r.legalHoldReason,
    whatsapp: whatsappFromRow(r),
    assignedAdvisor:
      r.assignedAdvisorCode === null
        ? null
        : { code: r.assignedAdvisorCode, name: r.assignedAdvisorName },
    lastSyncRunId: r.lastSyncRunId as Appointment['lastSyncRunId'],
    version: r.version,
    createdAt: r.createdAt as Appointment['createdAt'],
    updatedAt: r.updatedAt as Appointment['updatedAt'],
  };
}

/** Le quattro colonne dell'ultimo WhatsApp ricomposte; null se la pratica non ne ha uno. */
function whatsappFromRow(r: Row): WhatsAppDelivery | null {
  if (
    !isWhatsAppDeliveryState(r.whatsappState) ||
    r.whatsappKind === null ||
    r.whatsappAt === null
  ) {
    return null;
  }
  return {
    state: r.whatsappState,
    kind: r.whatsappKind as WhatsAppDelivery['kind'],
    at: r.whatsappAt as WhatsAppDelivery['at'],
    providerMessageId: r.whatsappMessageId,
  };
}

/** Dall'oggetto alle quattro colonne. */
function whatsappToColumns(w: WhatsAppDelivery | null): {
  whatsappState: string | null;
  whatsappKind: string | null;
  whatsappAt: string | null;
  whatsappMessageId: string | null;
} {
  return {
    whatsappState: w?.state ?? null,
    whatsappKind: w?.kind ?? null,
    whatsappAt: w?.at ?? null,
    whatsappMessageId: w?.providerMessageId ?? null,
  };
}

/** Dal dominio alla riga: tutte le colonne, cliente e veicolo serializzati. */
function toRow(a: Appointment): Prisma.AppointmentUncheckedCreateInput {
  return {
    ...whatsappToColumns(a.whatsapp),
    id: a.id,
    externalRef: a.externalRef,
    source: a.source,
    flow: a.flow,
    workOrderRef: a.workOrderRef,
    businessDate: a.businessDate,
    scheduledAt: a.scheduledAt,
    rescheduledAt: a.rescheduledAt,
    code: a.code,
    sequence: a.sequence,
    brandId: a.brandId,
    deskId: a.deskId,
    customerJson: toJson(a.customer),
    vehicleJson: toJson(a.vehicle),
    plate: normalizePlate(a.vehicle.plate),
    serviceDescription: a.serviceDescription,
    status: a.status,
    bayId: a.bayId,
    operatorId: a.operatorId,
    skipCount: a.skipCount,
    notes: a.notes,
    takenAt: a.takenAt,
    skippedAt: a.skippedAt,
    completedAt: a.completedAt,
    noShowAt: a.noShowAt,
    cancelledAt: a.cancelledAt,
    autoClosedAt: a.autoClosedAt,
    autoCloseConfirmedAt: a.autoCloseConfirmedAt,
    customerLateNoticeAt: a.customerLateNoticeAt,
    customerEtaAt: a.customerEtaAt,
    customerArrivedAt: a.customerArrivedAt,
    orderClosedAt: a.orderClosedAt,
    legalHoldAt: a.legalHoldAt,
    legalHoldReason: a.legalHoldReason,
    assignedAdvisorCode: a.assignedAdvisor?.code ?? null,
    assignedAdvisorName: a.assignedAdvisor?.name ?? null,
    lastSyncRunId: a.lastSyncRunId,
    version: a.version,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

export class PrismaAppointmentRepository implements IAppointmentRepository {
  constructor(
    private readonly db: Db,
    private readonly clock: IClock,
  ) {}

  async findById(id: AppointmentId): Promise<Appointment | null> {
    const r = await this.db.appointment.findUnique({ where: { id } });
    return r === null ? null : toEntity(r);
  }

  async findByExternalRef(externalRef: string, businessDate: IsoDate): Promise<Appointment | null> {
    const r = await this.db.appointment.findFirst({ where: { externalRef, businessDate } });
    return r === null ? null : toEntity(r);
  }

  async findByCode(code: QueueCode, businessDate: IsoDate): Promise<Appointment | null> {
    const r = await this.db.appointment.findFirst({ where: { code, businessDate } });
    return r === null ? null : toEntity(r);
  }

  async findByPlate(plate: PlateNumber, businessDate: IsoDate): Promise<readonly Appointment[]> {
    const rows = await this.db.appointment.findMany({
      where: { plate: normalizePlate(plate), businessDate, flow: 'INTAKE' },
    });
    return rows.map(toEntity).sort(compareByScheduleThenSequence);
  }

  async searchHistory(
    query: AppointmentHistoryQuery,
    limit: number,
  ): Promise<readonly Appointment[]> {
    const targa = query.plate === undefined ? '' : normalizePlate(query.plate);
    const codice = query.code?.trim().toUpperCase() ?? '';
    if (targa === '' && codice === '') {
      return [];
    }
    const OR: Prisma.AppointmentWhereInput[] = [];
    if (targa !== '') {
      OR.push({ plate: { contains: targa } });
    }
    if (codice !== '') {
      OR.push({ code: { contains: codice } });
    }
    const rows = await this.db.appointment.findMany({
      where: { OR },
      orderBy: [{ businessDate: 'desc' }, { scheduledAt: 'desc' }, { sequence: 'desc' }],
      take: Math.max(0, limit),
    });
    return rows.map(toEntity);
  }

  async listByDate(
    businessDate: IsoDate,
    filter?: AppointmentFilter,
  ): Promise<readonly Appointment[]> {
    const includeCancelled =
      filter?.includeCancelled ?? filter?.statuses?.includes('CANCELLED') ?? false;
    const flow = filter?.flow ?? 'INTAKE';
    const AND: Prisma.AppointmentWhereInput[] = [{ businessDate }];
    if (flow !== 'ALL') {
      AND.push({ flow });
    }
    if (!includeCancelled) {
      AND.push({ status: { not: 'CANCELLED' } });
    }
    if (filter?.brandIds !== undefined) {
      AND.push({ brandId: { in: [...filter.brandIds] } });
    }
    if (filter?.deskIds !== undefined) {
      AND.push({ deskId: { in: [...filter.deskIds] } });
    }
    if (filter?.statuses !== undefined) {
      AND.push({ status: { in: [...filter.statuses] } });
    }
    const rows = await this.db.appointment.findMany({ where: { AND } });
    return rows.map(toEntity).sort(compareByScheduleThenSequence);
  }

  async insert(appointment: Appointment): Promise<Result<Appointment, DomainError>> {
    const esistente = await this.db.appointment.findUnique({ where: { id: appointment.id } });
    if (esistente !== null) {
      return err(
        domainError('VALIDATION', `Pratica già presente: ${appointment.id}.`, {
          appointmentId: appointment.id,
        }),
      );
    }
    const stessoCodice = await this.db.appointment.findFirst({
      where: { businessDate: appointment.businessDate, code: appointment.code },
    });
    if (stessoCodice !== null) {
      return err(
        domainError('VALIDATION', `Codice ${appointment.code} già assegnato nella giornata.`, {
          code: appointment.code,
          existingAppointmentId: stessoCodice.id,
        }),
      );
    }
    if (appointment.externalRef !== null) {
      const stessoRef = await this.db.appointment.findFirst({
        where: { businessDate: appointment.businessDate, externalRef: appointment.externalRef },
      });
      if (stessoRef !== null) {
        return err(
          domainError(
            'VALIDATION',
            `Riferimento Infinity ${appointment.externalRef} già presente nella giornata.`,
            { externalRef: appointment.externalRef, existingAppointmentId: stessoRef.id },
          ),
        );
      }
    }
    const creata = await this.db.appointment.create({ data: toRow(appointment) });
    return ok(toEntity(creata));
  }

  async update(
    appointment: Appointment,
    expectedVersion: number,
  ): Promise<Result<Appointment, DomainError>> {
    // Le colonne dell'ultimo WhatsApp non passano da qui: le scrive solo il webhook di esito.
    const {
      id: _id,
      whatsappState: _ws,
      whatsappKind: _wk,
      whatsappAt: _wa,
      whatsappMessageId: _wm,
      // Anche l'accettatore assegnato: lo scrive solo la sync, con `updateAssignedAdvisor`.
      assignedAdvisorCode: _ac,
      assignedAdvisorName: _an,
      ...dati
    } = toRow(appointment);
    const aggiornate = await this.db.appointment.updateMany({
      where: { id: appointment.id, version: expectedVersion },
      data: { ...dati, version: expectedVersion + 1, updatedAt: this.clock.nowIso() },
    });
    if (aggiornate.count === 0) {
      const corrente = await this.db.appointment.findUnique({ where: { id: appointment.id } });
      if (corrente === null) {
        return err(domainError('NOT_FOUND', `Pratica non trovata: ${appointment.id}.`));
      }
      return err(
        domainError(
          'VERSION_CONFLICT',
          "La pratica è stata modificata da un'altra postazione. Ricarica e riprova.",
          {
            appointmentId: appointment.id,
            expectedVersion,
            currentVersion: corrente.version,
            current: toEntity(corrente),
          },
        ),
      );
    }
    const dopo = await this.db.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    return ok(toEntity(dopo));
  }

  async updateWhatsAppDelivery(
    id: AppointmentId,
    delivery: WhatsAppDelivery | null,
  ): Promise<Appointment | null> {
    // Nessuna condizione sulla versione e nessun bump: è metadato di consegna, non lavoro al banco.
    const aggiornate = await this.db.appointment.updateMany({
      where: { id },
      data: whatsappToColumns(delivery),
    });
    if (aggiornate.count === 0) {
      return null;
    }
    const dopo = await this.db.appointment.findUnique({ where: { id } });
    return dopo === null ? null : toEntity(dopo);
  }

  async updateAssignedAdvisor(
    id: AppointmentId,
    advisor: AssignedAdvisor | null,
  ): Promise<Appointment | null> {
    // Nessuna condizione sulla versione e nessun bump: è un dato del gestionale, non lavoro al banco.
    const aggiornate = await this.db.appointment.updateMany({
      where: { id },
      data: {
        assignedAdvisorCode: advisor?.code ?? null,
        assignedAdvisorName: advisor?.name ?? null,
      },
    });
    if (aggiornate.count === 0) {
      return null;
    }
    const dopo = await this.db.appointment.findUnique({ where: { id } });
    return dopo === null ? null : toEntity(dopo);
  }

  async reserveNextSequence(businessDate: IsoDate, prefix: string): Promise<number> {
    // Un solo `upsert` con incremento: SQLite serializza le scritture, quindi due postazioni che
    // chiedono un numero nello stesso istante ne ricevono due diversi. Il numero non si ridà.
    const riga = await this.db.sequence.upsert({
      where: { businessDate_prefix: { businessDate, prefix } },
      create: { businessDate, prefix, value: 1 },
      update: { value: { increment: 1 } },
    });
    return riga.value;
  }

  async clear(businessDate?: IsoDate): Promise<void> {
    if (businessDate === undefined) {
      await this.db.appointment.deleteMany();
      await this.db.sequence.deleteMany();
      return;
    }
    await this.db.appointment.deleteMany({ where: { businessDate } });
    await this.db.sequence.deleteMany({ where: { businessDate } });
  }
}
