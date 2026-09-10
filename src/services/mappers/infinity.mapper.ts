// Mapping PURO dal DTO Infinity al dominio, condiviso da mock e adapter reale:
// gli errori di mapping emergono ora, non in M7. Non assegna il codice progressivo
// (compete al CodeGenerator/QueueService in M1).

import type { Brand } from '@/domain/entities/brand';
import type { Customer } from '@/domain/entities/customer';
import type { Desk } from '@/domain/entities/desk';
import type { Vehicle } from '@/domain/entities/vehicle';
import type { DomainError } from '@/domain/errors';
import { domainError } from '@/domain/errors';
import type { DeskId } from '@/domain/ids';
import { asCustomerId, asVehicleId } from '@/domain/ids';
import type { Result } from '@/domain/result';
import { err, ok } from '@/domain/result';
import { sameReferenceCode } from '@/domain/value-objects/code';
import type { IsoDate, IsoDateTime } from '@/domain/value-objects/iso-date';
import { isIsoDate, toIsoDateTime } from '@/domain/value-objects/iso-date';
import { parsePhoneE164 } from '@/domain/value-objects/phone';
import { parsePlate } from '@/domain/value-objects/plate';
import { toBusinessDate } from '@/lib/dates';
import type { InfinityAgendaDto, InfinityAppointmentDto } from '../dto/infinity.dto';
import type { IIdGenerator } from '../interfaces/IIdGenerator';

/** Bozza di pratica: dati di dominio pronti, senza codice né stato (assegnati dal QueueService). */
export interface AppointmentDraft {
  readonly externalRef: string;
  readonly scheduledAt: IsoDateTime;
  readonly businessDate: IsoDate;
  readonly brand: Brand;
  readonly deskId: DeskId | null;
  readonly customer: Customer;
  readonly vehicle: Vehicle;
  readonly serviceDescription: string | null;
  readonly cancelled: boolean;
}

/** Contesto del mapping: dati di riferimento e generatore id. */
export interface InfinityMappingContext {
  readonly brands: readonly Brand[];
  readonly desks: readonly Desk[];
  readonly ids: IIdGenerator;
  /** Fuso per calcolare la giornata operativa (default Europe/Rome). */
  readonly timeZone?: string;
}

/** Contesto del mapping di un singolo appuntamento: include la giornata dell'agenda richiesta. */
export interface InfinityAppointmentMappingContext extends InfinityMappingContext {
  /** Giornata operativa dell'agenda: la bozza la eredita, non la ricava da `scheduledAt`. */
  readonly businessDate: IsoDate;
}

/** Esito del mapping di un'intera agenda. */
export interface InfinityAgendaMapping {
  readonly businessDate: IsoDate;
  readonly drafts: readonly AppointmentDraft[];
  readonly rejected: readonly { readonly externalId: string | null; readonly error: DomainError }[];
}

/**
 * Converte un appuntamento Infinity in bozza di dominio.
 * Targa non valida, orario non interpretabile, brand sconosciuto o orario fuori dalla
 * giornata dell'agenda → VALIDATION (finisce fra i `rejected`, la sync diventa PARTIAL).
 * Telefono non valido → null (la notifica diventerà NO_RECIPIENT, la pratica non si perde).
 */
export function mapInfinityAppointment(
  dto: InfinityAppointmentDto,
  ctx: InfinityAppointmentMappingContext,
): Result<AppointmentDraft, DomainError> {
  const brand = ctx.brands.find((b) => sameReferenceCode(b.code, dto.brandCode));
  if (brand === undefined) {
    return err(
      domainError('VALIDATION', `Marchio sconosciuto: "${dto.brandCode}".`, {
        externalId: dto.externalId,
        brandCode: dto.brandCode,
      }),
    );
  }

  const plate = parsePlate(dto.plate);
  if (!plate.ok) {
    return err({
      ...plate.error,
      details: { ...plate.error.details, externalId: dto.externalId },
    });
  }

  const scheduledAt = toIsoDateTime(dto.scheduledAt);
  if (scheduledAt === null) {
    return err(
      domainError('VALIDATION', `Orario di prenotazione non valido: "${dto.scheduledAt}".`, {
        externalId: dto.externalId,
      }),
    );
  }

  // La giornata è quella dell'agenda richiesta: un orario che cade in un altro giorno
  // (dato incoerente, es. a ridosso della mezzanotte) romperebbe findByExternalRef(externalRef, businessDate).
  const scheduledBusinessDate = toBusinessDate(
    new Date(scheduledAt),
    ctx.timeZone ?? 'Europe/Rome',
  );
  if (scheduledBusinessDate !== ctx.businessDate) {
    return err(
      domainError(
        'VALIDATION',
        `Orario di prenotazione ${dto.scheduledAt} fuori dalla giornata ${ctx.businessDate}.`,
        { externalId: dto.externalId, scheduledBusinessDate, businessDate: ctx.businessDate },
      ),
    );
  }

  const phoneResult = dto.customer.phone === null ? null : parsePhoneE164(dto.customer.phone);
  const phone = phoneResult !== null && phoneResult.ok ? phoneResult.value : null;

  const desk =
    dto.deskCode === null
      ? undefined
      : ctx.desks.find((d) => sameReferenceCode(d.code, dto.deskCode ?? ''));

  const customer: Customer = {
    id: ctx.ids.nextAs(asCustomerId),
    externalRef: dto.customer.externalId,
    firstName: dto.customer.firstName.trim(),
    lastName: dto.customer.lastName.trim(),
    phone,
    email: dto.customer.email,
    whatsappOptIn: dto.customer.whatsappOptIn === true,
  };

  const vehicle: Vehicle = {
    id: ctx.ids.nextAs(asVehicleId),
    plate: plate.value,
    brandId: brand.id,
    model: dto.vehicleModel.trim(),
    vin: dto.vin,
  };

  return ok({
    externalRef: dto.externalId,
    scheduledAt,
    businessDate: ctx.businessDate,
    brand,
    deskId: desk?.id ?? null,
    customer,
    vehicle,
    serviceDescription: dto.serviceDescription,
    cancelled: dto.cancelled,
  });
}

/**
 * Mappa un'intera agenda separando bozze valide e appuntamenti rifiutati (contatore `rejected`).
 * Un'agenda con `businessDate` malformata viene rifiutata in blocco (VALIDATION): la sync
 * la registra come FAILED invece di creare pratiche nel giorno sbagliato.
 */
export function mapInfinityAgenda(
  agenda: InfinityAgendaDto,
  ctx: InfinityMappingContext,
): Result<InfinityAgendaMapping, DomainError> {
  if (!isIsoDate(agenda.businessDate)) {
    return err(
      domainError('VALIDATION', `Giornata dell'agenda non valida: "${agenda.businessDate}".`, {
        businessDate: agenda.businessDate,
      }),
    );
  }
  const appointmentCtx: InfinityAppointmentMappingContext = {
    ...ctx,
    businessDate: agenda.businessDate,
  };
  const drafts: AppointmentDraft[] = [];
  const rejected: { externalId: string | null; error: DomainError }[] = [];
  for (const dto of agenda.appointments) {
    const mapped = mapInfinityAppointment(dto, appointmentCtx);
    if (mapped.ok) {
      drafts.push(mapped.value);
    } else {
      rejected.push({ externalId: dto.externalId, error: mapped.error });
    }
  }
  return ok({ businessDate: agenda.businessDate, drafts, rejected });
}
