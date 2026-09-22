// Inserimento manuale di una pratica (cliente senza appuntamento, o agenda Infinity non arrivata).
//
// È il fallback promesso dalla regola d'oro: l'officina non si ferma perché manca un dato nel
// gestionale. La pratica nasce direttamente nella coda di oggi, con il prossimo codice progressivo
// della stessa sequenza usata dalla sync (così i monitor chiamano numeri coerenti), e porta con sé
// solo ciò che l'accettatore sa in quel momento: targa, nome, telefono, marca, cosa vuole il
// cliente. Il resto (modello, riferimento esterno) resta vuoto: meglio una pratica scarna in coda
// che un cliente fuori dalla coda.
import type { Appointment } from '@/domain/entities/appointment';
import { isInQueue } from '@/domain/entities/appointment';
import type { Brand } from '@/domain/entities/brand';
import type { Desk } from '@/domain/entities/desk';
import { domainError, type DomainError } from '@/domain/errors';
import {
  asAppointmentId,
  asBrandId,
  asCustomerId,
  asDeskId,
  asVehicleId,
  type DeskId,
} from '@/domain/ids';
import { err, ok, type Result } from '@/domain/result';
import { parsePhoneE164 } from '@/domain/value-objects/phone';
import { parsePlate } from '@/domain/value-objects/plate';
import type { IAppointmentRepository, IReferenceDataRepository } from '@/repositories/interfaces';
import type { IClock } from '@/services/interfaces/IClock';
import type { IEventBus } from '@/services/interfaces/IEventBus';
import type { IIdGenerator } from '@/services/interfaces/IIdGenerator';
import type { ILogger } from '@/services/interfaces/ILogger';
import type { CodeGenerator } from './CodeGenerator';
import type { ActionContext } from './QueueService';

export interface ManualIntakeServiceDeps {
  readonly appointments: IAppointmentRepository;
  readonly referenceData: IReferenceDataRepository;
  readonly codeGenerator: CodeGenerator;
  readonly eventBus: IEventBus;
  readonly clock: IClock;
  readonly ids: IIdGenerator;
  readonly logger: ILogger;
}

/** Quello che l'accettatore sa di un cliente arrivato senza appuntamento. */
export interface ManualIntakeInput {
  readonly plate: string;
  /** Nome e cognome come li dice il cliente: si separano qui. */
  readonly customerName: string;
  readonly phone: string | null;
  readonly brandId: string;
  /** Sportello di destinazione; null = quello che serve il marchio. */
  readonly deskId: string | null;
  /** Cosa chiede il cliente (lavorazione, note). */
  readonly serviceDescription: string | null;
  /** Il cliente accetta gli avvisi WhatsApp (chiesto al banco); altrimenti si usa l'SMS. */
  readonly whatsappOptIn: boolean;
}

/** Modello sconosciuto all'inserimento: si legge così in coda finché nessuno lo corregge. */
export const UNKNOWN_MODEL = 'modello n/d';

/** "Mario Rossi" → nome Mario, cognome Rossi; una parola sola è il cognome. */
export function splitCustomerName(raw: string): { firstName: string; lastName: string } {
  const parti = raw
    .trim()
    .split(/\s+/)
    .filter((p) => p !== '');
  const first = parti[0] ?? '';
  if (parti.length <= 1) {
    return { firstName: '', lastName: first };
  }
  return { firstName: first, lastName: parti.slice(1).join(' ') };
}

export class ManualIntakeService {
  private readonly logger: ILogger;

  constructor(private readonly deps: ManualIntakeServiceDeps) {
    this.logger = deps.logger.child('[Intake]');
  }

  async create(
    input: ManualIntakeInput,
    ctx: ActionContext,
  ): Promise<Result<Appointment, DomainError>> {
    const nome = splitCustomerName(input.customerName);
    if (nome.lastName.length < 2) {
      return err(domainError('VALIDATION', 'Indicare nome e cognome del cliente.'));
    }
    const plate = parsePlate(input.plate);
    if (!plate.ok) {
      return plate;
    }
    const telefono =
      input.phone === null || input.phone.trim() === '' ? null : parsePhoneE164(input.phone);
    if (telefono !== null && !telefono.ok) {
      return telefono;
    }

    const brands = await this.deps.referenceData.listBrands();
    const brand = brands.find((b) => b.id === asBrandId(input.brandId) && b.isActive);
    if (brand === undefined) {
      return err(domainError('VALIDATION', 'Marca sconosciuta.', { brandId: input.brandId }));
    }
    const desk = await this.resolveDesk(input.deskId, brand);
    if (!desk.ok) {
      return desk;
    }

    // Una targa già in coda oggi non si inserisce due volte: si cerca la pratica esistente.
    const today = this.deps.clock.today();
    const giaInCoda = (await this.deps.appointments.findByPlate(plate.value, today)).find(
      (a) => isInQueue(a.status) || a.status === 'IN_PROGRESS',
    );
    if (giaInCoda !== undefined) {
      return err(
        domainError(
          'VALIDATION',
          `La targa ${plate.value} è già in coda oggi con il codice ${giaInCoda.code}.`,
          { appointmentId: giaInCoda.id, code: giaInCoda.code },
        ),
      );
    }

    const assigned = await this.deps.codeGenerator.next(today, brand);
    const now = this.deps.clock.nowIso();
    const appointment: Appointment = {
      id: this.deps.ids.nextAs(asAppointmentId),
      externalRef: null,
      source: 'MANUAL',
      flow: 'INTAKE',
      workOrderRef: null,
      businessDate: today,
      // Senza appuntamento l'orario atteso è adesso: si mette in coda dietro a chi era prenotato prima.
      scheduledAt: now,
      rescheduledAt: null,
      code: assigned.code,
      sequence: assigned.sequence,
      brandId: brand.id,
      deskId: desk.value,
      customer: {
        id: this.deps.ids.nextAs(asCustomerId),
        externalRef: null,
        firstName: nome.firstName,
        lastName: nome.lastName,
        phone: telefono === null ? null : telefono.value,
        email: null,
        whatsappOptIn: input.whatsappOptIn,
      },
      vehicle: {
        id: this.deps.ids.nextAs(asVehicleId),
        plate: plate.value,
        brandId: brand.id,
        model: UNKNOWN_MODEL,
        vin: null,
      },
      serviceDescription:
        input.serviceDescription === null || input.serviceDescription.trim() === ''
          ? null
          : input.serviceDescription.trim(),
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
      autoClosedAt: null,
      autoCloseConfirmedAt: null,
      customerLateNoticeAt: null,
      customerArrivedAt: null,
      customerEtaAt: null,
      orderClosedAt: null,
      legalHoldAt: null,
      legalHoldReason: null,
      whatsapp: null,
      lastSyncRunId: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    const inserted = await this.deps.appointments.insert(appointment);
    if (!inserted.ok) {
      return inserted;
    }
    // Stesso evento della sync: la policy dei messaggi manda la conferma al cliente, la dashboard
    // e i monitor si aggiornano via SSE.
    this.deps.eventBus.publish({
      id: this.deps.ids.next(),
      occurredAt: now,
      correlationId: ctx.correlationId ?? this.deps.ids.next(),
      actor: { kind: 'OPERATOR', id: ctx.operatorId },
      type: 'APPOINTMENT_CREATED',
      appointmentId: inserted.value.id,
      source: 'MANUAL',
    });
    this.logger.info(`pratica manuale ${inserted.value.code} inserita`, {
      appointmentId: inserted.value.id,
      operatorId: ctx.operatorId,
      plate: plate.value,
    });
    return ok(inserted.value);
  }

  /** Sportello indicato dall'accettatore, oppure il primo che serve il marchio. */
  private async resolveDesk(
    deskId: string | null,
    brand: Brand,
  ): Promise<Result<DeskId | null, DomainError>> {
    const desks = await this.deps.referenceData.listDesks();
    if (deskId !== null && deskId !== '') {
      const desk = desks.find((d: Desk) => d.id === asDeskId(deskId) && d.isActive);
      if (desk === undefined) {
        return err(domainError('VALIDATION', 'Sportello sconosciuto.', { deskId }));
      }
      return ok(desk.id);
    }
    return ok(desks.find((d) => d.isActive && d.brandIds.includes(brand.id))?.id ?? null);
  }
}
