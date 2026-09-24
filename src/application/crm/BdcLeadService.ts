// Assenti e anomalie della giornata, letti dalla coda di uscita verso il CRM (modulo F).
//
// Dal 2026-09-24 il BDC non usa l'app: ogni assente (segnato al banco, dichiarato dal cliente su
// WhatsApp o rimasto in coda alla chiusura della giornata) e ogni anomalia partono da soli come
// lead verso il suo CRM (`CrmNotifier`, con riprova). Qui resta la lettura di quella stessa coda
// per l'amministratore — il pannello «Anomalie di oggi» — così quello che vede e quello che il CRM
// riceve sono lo stesso fatto e non possono divergere.
import type { Appointment } from '@/domain/entities/appointment';
import type { CrmEventType, CrmOutboxEvent } from '@/domain/entities/crm-outbox-event';
import { customerFullName } from '@/domain/entities/customer';
import type { OperatorId } from '@/domain/ids';
import type { BdcLeadsView, BdcLeadView } from '@/domain/read-models';
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
  /** Solo questi tipi (es. le sole anomalie per l'amministratore); assente = assenti e anomalie. */
  readonly types?: readonly CrmEventType[];
}

/**
 * Eventi che diventano lead per il BDC: gli assenti e, dal 2026-09-23, le anomalie di flusso sulla
 * pratica (il cliente saltato tre volte, da cercare: «Verificare presenza»).
 */
const LEAD_TYPES: readonly CrmEventType[] = ['NO_SHOW', 'ANOMALY'];

export class BdcLeadService {
  constructor(private readonly deps: BdcLeadServiceDeps) {}

  /** Lead del BDC, dai più recenti ai più vecchi; quelli ancora aperti restano in cima. */
  async listLeads(input: ListLeadsInput = {}): Promise<BdcLeadsView> {
    const eventi = await this.deps.outbox.listByStatus(['PENDING', 'SENT', 'FAILED', 'MANUAL']);
    const tipi = input.types ?? LEAD_TYPES;
    const candidati = eventi.filter((e) => LEAD_TYPES.includes(e.type) && tipi.includes(e.type));

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

  /** Evento in coda + pratica → riga del cruscotto. */
  private async toLead(evento: CrmOutboxEvent): Promise<BdcLeadView> {
    const appointment = await this.deps.appointments.findById(evento.appointmentId);
    const handledByName = await this.operatorName(evento.handledByOperatorId);
    const base = {
      eventId: evento.id,
      type: evento.type,
      anomalyKind: evento.anomalyKind,
      deliveryStatus: evento.status,
      appointmentId: evento.appointmentId,
      reason: evento.operatorNote,
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
