// Consegna al CRM/BDC gli eventi dell'officina (modulo F), con il patto della coda di uscita:
// l'evento viene PRIMA scritto nella outbox e POI inviato. Se l'invio fallisce l'evento resta in
// coda e nessuna informazione va persa; se riesce, la riga passa a SENT con l'identificativo
// restituito dal CRM. Nulla di tutto questo può bloccare l'officina: un CRM irraggiungibile non
// deve impedire di segnare un assente o di chiudere un'accettazione.
import type { Appointment } from '@/domain/entities/appointment';
import type { Brand } from '@/domain/entities/brand';
import type { CrmEventType, CrmOutboxEvent } from '@/domain/entities/crm-outbox-event';
import { asCrmOutboxEventId } from '@/domain/ids';
import type { OperatorId } from '@/domain/ids';
import type { ICrmOutboxRepository, IReferenceDataRepository } from '@/repositories/interfaces';
import type { CrmPayload } from '@/services/interfaces/ICrmService';
import type { ICrmService } from '@/services/interfaces/ICrmService';
import type { IClock } from '@/services/interfaces/IClock';
import type { IIdGenerator } from '@/services/interfaces/IIdGenerator';
import type { ILogger } from '@/services/interfaces/ILogger';
import {
  buildCheckInIdempotencyKey,
  buildNoShowIdempotencyKey,
  toCrmCheckInPayload,
  toCrmNoShowPayload,
} from '@/services/mappers/crm.mapper';

export interface CrmNotifierDeps {
  readonly crm: ICrmService;
  readonly outbox: ICrmOutboxRepository;
  readonly referenceData: IReferenceDataRepository;
  readonly clock: IClock;
  readonly ids: IIdGenerator;
  readonly logger: ILogger;
}

/** Esito della consegna, per i log e per i test. */
export type CrmDeliveryOutcome = 'SENT' | 'QUEUED' | 'ALREADY_SENT' | 'SKIPPED';

export interface CrmDelivery {
  readonly outcome: CrmDeliveryOutcome;
  readonly event: CrmOutboxEvent | null;
}

/** Dati raccolti al tablet durante l'accettazione al veicolo. */
export interface CheckInReport {
  readonly inspectionNotes: string | null;
  readonly photos: readonly { readonly url: string; readonly capturedAt: string }[];
  readonly operatorId: OperatorId;
}

export class CrmNotifier {
  private readonly logger: ILogger;

  constructor(private readonly deps: CrmNotifierDeps) {
    this.logger = deps.logger.child('[CRM]');
  }

  /** Cliente non presentatosi: il BDC lo ricontatterà. */
  async notifyNoShow(
    appointment: Appointment,
    reason: string | null,
    correlationId: string,
  ): Promise<CrmDelivery> {
    const brand = await this.findBrand(appointment);
    if (brand === null) {
      return { outcome: 'SKIPPED', event: null };
    }
    const detectedAt = appointment.noShowAt ?? this.deps.clock.nowIso();
    const payload = toCrmNoShowPayload(appointment, brand, detectedAt, 'MARKED_BY_OPERATOR');
    return this.deliver({
      type: 'NO_SHOW',
      idempotencyKey: buildNoShowIdempotencyKey(appointment),
      appointment,
      payload,
      // Il motivo scritto dall'accettatore resta nella outbox anche se il DTO non lo prevede.
      extraPayload: { code: appointment.code, reason },
      correlationId,
      send: (options) => this.deps.crm.notifyNoShow(payload, options),
    });
  }

  /** Accettazione conclusa al veicolo, con note e foto del tablet. */
  async notifyCheckIn(
    appointment: Appointment,
    report: CheckInReport,
    correlationId: string,
  ): Promise<CrmDelivery> {
    const brand = await this.findBrand(appointment);
    if (brand === null) {
      return { outcome: 'SKIPPED', event: null };
    }
    const completedAt = appointment.completedAt ?? this.deps.clock.nowIso();
    const payload = toCrmCheckInPayload(appointment, brand, {
      inspectionNotes: report.inspectionNotes,
      photos: report.photos,
      completedAt,
      operatorId: report.operatorId,
    });
    return this.deliver({
      type: 'CHECK_IN',
      idempotencyKey: buildCheckInIdempotencyKey(appointment),
      appointment,
      payload,
      extraPayload: {
        code: appointment.code,
        photoCount: report.photos.length,
        hasNotes: report.inspectionNotes !== null,
      },
      correlationId,
      send: (options) => this.deps.crm.notifyCheckIn(payload, options),
    });
  }

  private async findBrand(appointment: Appointment): Promise<Brand | null> {
    const brands = await this.deps.referenceData.listBrands();
    const brand = brands.find((b) => b.id === appointment.brandId) ?? null;
    if (brand === null) {
      this.logger.warn('evento non inviato: marchio sconosciuto', {
        appointmentId: appointment.id,
        brandId: appointment.brandId,
      });
    }
    return brand;
  }

  /**
   * Scrive l'evento nella coda di uscita e tenta la consegna. Non lancia mai: qualunque guasto
   * lascia la riga in coda, pronta per il rinvio, e viene solo segnalato nei log.
   */
  private async deliver(input: {
    readonly type: CrmEventType;
    readonly idempotencyKey: string;
    readonly appointment: Appointment;
    readonly payload: CrmPayload;
    readonly extraPayload: Readonly<Record<string, unknown>>;
    readonly correlationId: string;
    readonly send: (options: {
      readonly correlationId: string;
    }) => ReturnType<ICrmService['notifyNoShow']>;
  }): Promise<CrmDelivery> {
    const now = this.deps.clock.nowIso();
    try {
      const esistente = await this.deps.outbox.findByIdempotencyKey(input.idempotencyKey);
      if (esistente !== null && esistente.status === 'SENT') {
        return { outcome: 'ALREADY_SENT', event: esistente };
      }

      const evento: CrmOutboxEvent =
        esistente ??
        (await this.deps.outbox.insert({
          id: this.deps.ids.nextAs(asCrmOutboxEventId),
          type: input.type,
          anomalyKind: null,
          appointmentId: input.appointment.id,
          idempotencyKey: input.idempotencyKey,
          payload: { ...input.extraPayload, appointmentId: input.appointment.id },
          status: 'PENDING',
          attemptCount: 0,
          nextAttemptAt: now,
          lastError: null,
          crmAckId: null,
          createdAt: now,
          sentAt: null,
          handledAt: null,
          handledByOperatorId: null,
          handledNote: null,
        }));

      const risultato = await input.send({ correlationId: input.correlationId });
      if (!risultato.ok) {
        const aggiornato = await this.deps.outbox.update({
          ...evento,
          status: 'PENDING',
          attemptCount: evento.attemptCount + 1,
          lastError: `${risultato.error.code}: ${risultato.error.message}`,
          nextAttemptAt: this.deps.clock.nowIso(),
        });
        this.logger.warn(
          `${input.type} ${input.appointment.code}: CRM non raggiungibile, evento in coda di rinvio`,
          { errore: risultato.error.code, tentativi: aggiornato.attemptCount },
        );
        return { outcome: 'QUEUED', event: aggiornato };
      }

      const inviato = await this.deps.outbox.update({
        ...evento,
        status: 'SENT',
        attemptCount: evento.attemptCount + 1,
        crmAckId: risultato.value.ackId,
        sentAt: this.deps.clock.nowIso(),
        nextAttemptAt: null,
        lastError: null,
      });
      this.logger.info(`${input.type} ${input.appointment.code}: inviato al CRM`, {
        ackId: risultato.value.ackId,
      });
      return { outcome: 'SENT', event: inviato };
    } catch (cause) {
      this.logger.error(`${input.type} ${input.appointment.code}: consegna al CRM interrotta`, {
        message: cause instanceof Error ? cause.message : String(cause),
      });
      return { outcome: 'QUEUED', event: null };
    }
  }
}
