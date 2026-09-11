// Cruscotto del BDC (modulo F): i clienti che non si sono presentati diventano lead da
// ricontattare. La fonte è la coda di uscita verso il CRM, non una tabella parallela: l'evento che
// il CRM riceve e la riga che il BDC lavora sono lo stesso fatto, così non possono divergere.
//
// La chiusura del lead è deliberatamente indipendente dalla consegna al CRM: se il CRM è giù
// l'evento resta da rinviare, ma il BDC ha comunque telefonato al cliente e deve poterlo dire.
// Per questo "ricontattato" scrive lo stato `MANUAL`, che vale sia come esito del lavoro del BDC
// sia come "non ritentare più" per lo svuotamento automatico (M6-T02).
import type { Appointment } from '@/domain/entities/appointment';
import type { CrmOutboxEvent } from '@/domain/entities/crm-outbox-event';
import { customerFullName } from '@/domain/entities/customer';
import { domainError, type DomainError } from '@/domain/errors';
import type { CrmOutboxEventId, OperatorId } from '@/domain/ids';
import type { BdcLeadsView, BdcLeadView } from '@/domain/read-models';
import { err, ok, type Result } from '@/domain/result';
import type {
  IAppointmentRepository,
  ICrmOutboxRepository,
  IOperatorRepository,
  IReferenceDataRepository,
} from '@/repositories/interfaces';
import type { IClock } from '@/services/interfaces/IClock';
import type { ILogger } from '@/services/interfaces/ILogger';

export interface BdcLeadServiceDeps {
  readonly outbox: ICrmOutboxRepository;
  readonly appointments: IAppointmentRepository;
  readonly referenceData: IReferenceDataRepository;
  readonly operators: IOperatorRepository;
  readonly clock: IClock;
  readonly logger: ILogger;
}

export interface ListLeadsInput {
  /** Giornata da mostrare; null = tutte quelle ancora in memoria. */
  readonly businessDate?: string | null;
  /** Include anche i lead già chiusi (per verificare cosa è stato fatto). */
  readonly includeHandled?: boolean;
}

export interface MarkContactedInput {
  readonly eventId: CrmOutboxEventId;
  /** Esito della telefonata, scritto dal BDC. */
  readonly note: string | null;
}

/** Eventi che diventano lead per il BDC. Le anomalie di flusso arrivano con M6-T02. */
const LEAD_TYPES = ['NO_SHOW'] as const;

function textOf(payload: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export class BdcLeadService {
  private readonly logger: ILogger;

  constructor(private readonly deps: BdcLeadServiceDeps) {
    this.logger = deps.logger.child('[BDC]');
  }

  /** Lead del BDC, dai più recenti ai più vecchi; quelli ancora aperti restano in cima. */
  async listLeads(input: ListLeadsInput = {}): Promise<BdcLeadsView> {
    const eventi = await this.deps.outbox.listByStatus(['PENDING', 'SENT', 'FAILED', 'MANUAL']);
    const candidati = eventi.filter((e) =>
      LEAD_TYPES.includes(e.type as (typeof LEAD_TYPES)[number]),
    );

    const leads: BdcLeadView[] = [];
    for (const evento of candidati) {
      const lead = await this.toLead(evento);
      const giornataOk =
        input.businessDate === undefined ||
        input.businessDate === null ||
        lead.businessDate === input.businessDate;
      if (!giornataOk) {
        continue;
      }
      if (lead.handled && input.includeHandled !== true) {
        continue;
      }
      leads.push(lead);
    }

    leads.sort((a, b) => {
      if (a.handled !== b.handled) {
        return a.handled ? 1 : -1;
      }
      return a.detectedAt < b.detectedAt ? 1 : a.detectedAt > b.detectedAt ? -1 : 0;
    });

    // I conteggi guardano sempre tutti gli eventi della giornata scelta, anche quando l'elenco
    // mostra i soli lead aperti: l'intestazione deve dire quanto è stato fatto, non solo cosa resta.
    const tutti = await Promise.all(candidati.map((e) => this.toLead(e)));
    const dellaGiornata = tutti.filter(
      (l) =>
        input.businessDate === undefined ||
        input.businessDate === null ||
        l.businessDate === input.businessDate,
    );
    return {
      leads,
      openCount: dellaGiornata.filter((l) => !l.handled).length,
      handledCount: dellaGiornata.filter((l) => l.handled).length,
    };
  }

  /**
   * "Segna come ricontattato": chiude il lead con nome di chi ha telefonato ed esito.
   * È volutamente idempotente — due operatori del BDC che premono insieme non devono litigare,
   * il primo ricontatto registrato resta quello buono.
   */
  async markContacted(
    input: MarkContactedInput,
    actor: { readonly operatorId: OperatorId },
  ): Promise<Result<BdcLeadView, DomainError>> {
    const evento = await this.deps.outbox.findById(input.eventId);
    if (evento === null) {
      return err(domainError('NOT_FOUND', `Lead non trovato: ${input.eventId}.`));
    }
    if (evento.status === 'MANUAL') {
      return ok(await this.toLead(evento));
    }

    const nota = input.note?.trim();
    const aggiornato = await this.deps.outbox.update({
      ...evento,
      status: 'MANUAL',
      // Nessun altro rinvio automatico: il cliente è già stato ricontattato a voce.
      nextAttemptAt: null,
      handledAt: this.deps.clock.nowIso(),
      handledByOperatorId: actor.operatorId,
      handledNote: nota === undefined || nota.length === 0 ? null : nota,
    });
    this.logger.info(`lead ricontattato: ${textOf(evento.payload, 'code') ?? evento.id}`, {
      eventId: evento.id,
      operatorId: actor.operatorId,
    });
    return ok(await this.toLead(aggiornato));
  }

  /** Evento in coda + pratica → riga del cruscotto. */
  private async toLead(evento: CrmOutboxEvent): Promise<BdcLeadView> {
    const appointment = await this.deps.appointments.findById(evento.appointmentId);
    const handledByName = await this.operatorName(evento.handledByOperatorId);
    const base = {
      eventId: evento.id,
      type: evento.type,
      deliveryStatus: evento.status,
      appointmentId: evento.appointmentId,
      reason: textOf(evento.payload, 'reason'),
      detectedAt: evento.createdAt,
      handled: evento.status === 'MANUAL',
      handledAt: evento.handledAt,
      handledByName,
      handledNote: evento.handledNote,
    };

    if (appointment === null) {
      // Pratica non più in memoria (riavvio, giornata archiviata): resta quanto sta nell'evento.
      return {
        ...base,
        code: null,
        businessDate: null,
        scheduledAt: null,
        customerName: null,
        phone: null,
        plate: null,
        vehicle: null,
        deskCode: null,
      };
    }
    return {
      ...base,
      code: appointment.code,
      businessDate: appointment.businessDate,
      scheduledAt: appointment.scheduledAt,
      customerName: customerFullName(appointment.customer),
      phone: appointment.customer.phone,
      plate: appointment.vehicle.plate,
      vehicle: await this.vehicleLabel(appointment),
      deskCode: await this.deskCode(appointment),
    };
  }

  private async operatorName(operatorId: OperatorId | null): Promise<string | null> {
    if (operatorId === null) {
      return null;
    }
    const operatore = await this.deps.operators.findById(operatorId);
    return operatore?.displayName ?? null;
  }

  private async vehicleLabel(appointment: Appointment): Promise<string | null> {
    const brands = await this.deps.referenceData.listBrands();
    const brand = brands.find((b) => b.id === appointment.vehicle.brandId) ?? null;
    const modello = appointment.vehicle.model;
    if (brand === null) {
      return modello;
    }
    return modello === null ? brand.name : `${brand.name} ${modello}`;
  }

  private async deskCode(appointment: Appointment): Promise<string | null> {
    const desks = await this.deps.referenceData.listDesks();
    return desks.find((d) => d.id === appointment.deskId)?.code ?? null;
  }
}
