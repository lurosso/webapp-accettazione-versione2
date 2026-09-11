// Consegna al CRM/BDC gli eventi dell'officina (modulo F), con il patto della coda di uscita:
// l'evento viene PRIMA scritto nella outbox e POI inviato. Se l'invio fallisce l'evento resta in
// coda e nessuna informazione va persa; se riesce, la riga passa a SENT con l'identificativo
// restituito dal CRM. Nulla di tutto questo può bloccare l'officina: un CRM irraggiungibile non
// deve impedire di segnare un assente o di chiudere un'accettazione.
//
// Nella coda finisce il payload ESATTO consegnato al CRM: ogni rinvio rispedisce quello, senza
// ricostruirlo dalla pratica, che nel frattempo può essere cambiata. I tentativi automatici
// seguono un'attesa progressiva e a un certo punto si fermano: un CRM irrimediabilmente giù non
// deve far girare a vuoto il processo per giorni.
import {
  CRM_CALL_TIMEOUT_MS,
  CRM_DRAIN_BATCH,
  CRM_MAX_ATTEMPTS,
  CRM_RETRY_BACKOFF_MINUTES,
} from '@/config/constants';
import type { Appointment } from '@/domain/entities/appointment';
import type { Brand } from '@/domain/entities/brand';
import type { CrmEventType, CrmOutboxEvent } from '@/domain/entities/crm-outbox-event';
import { asCrmOutboxEventId } from '@/domain/ids';
import type { CrmOutboxEventId, OperatorId } from '@/domain/ids';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import type { ICrmOutboxRepository, IReferenceDataRepository } from '@/repositories/interfaces';
import type {
  CrmAckDto,
  CrmAnomalyPayloadDto,
  CrmCheckInPayloadDto,
  CrmNoShowPayloadDto,
} from '@/services/dto/crm.dto';
import type { CallOptions, ProviderResult } from '@/services/interfaces/common';
import type { CrmPayload, ICrmService } from '@/services/interfaces/ICrmService';
import type { IClock } from '@/services/interfaces/IClock';
import type { IEventBus } from '@/services/interfaces/IEventBus';
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
  /** Opzionale: pubblica `CRM_EVENT_CHANGED` a ogni cambio di stato della coda di uscita. */
  readonly eventBus?: IEventBus | undefined;
  /** Tempo massimo per una chiamata al CRM (default `CRM_CALL_TIMEOUT_MS`). */
  readonly callTimeoutMs?: number | undefined;
}

/**
 * Esito della consegna, per i log e per i test.
 * `QUEUED` = si riproverà più tardi; `GIVEN_UP` = tentativi esauriti o rifiuto definitivo del CRM,
 * la riga resta `FAILED` e la riprova diventa una decisione di una persona.
 */
export type CrmDeliveryOutcome = 'SENT' | 'QUEUED' | 'GIVEN_UP' | 'ALREADY_SENT' | 'SKIPPED';

export interface CrmDelivery {
  readonly outcome: CrmDeliveryOutcome;
  readonly event: CrmOutboxEvent | null;
}

/** Riepilogo di una passata di svuotamento della coda (temporizzatore interno o cron esterno). */
export interface CrmDrainSummary {
  readonly attempted: number;
  readonly sent: number;
  readonly queued: number;
  readonly givenUp: number;
}

/** Dati raccolti al tablet durante l'accettazione al veicolo. */
export interface CheckInReport {
  readonly inspectionNotes: string | null;
  readonly photos: readonly {
    readonly url: string;
    readonly capturedAt: string;
    readonly category: string | null;
  }[];
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
      // Il motivo scritto dall'accettatore non fa parte del DTO, ma è quello che il BDC legge nel
      // cruscotto prima di telefonare: resta accanto al payload, non dentro.
      operatorNote: reason,
      correlationId,
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
      operatorNote: null,
      correlationId,
    });
  }

  /**
   * Riprova a mano un evento della coda (pannello Sistema): riparte anche da `FAILED`, perché chi
   * preme il pulsante sa che il CRM è tornato su e non deve aspettare il prossimo giro automatico.
   */
  async retry(eventId: CrmOutboxEventId, correlationId: string): Promise<CrmDelivery> {
    const evento = await this.deps.outbox.findById(eventId);
    if (evento === null) {
      return { outcome: 'SKIPPED', event: null };
    }
    if (evento.status === 'SENT') {
      return { outcome: 'ALREADY_SENT', event: evento };
    }
    return this.attempt(evento, correlationId, { manuale: true });
  }

  /**
   * Svuota la coda di uscita: prende gli eventi la cui attesa è scaduta e prova a consegnarli.
   * La chiamano sia il temporizzatore interno sia l'endpoint per un cron esterno; girare due
   * volte non fa danni, perché ogni evento porta la propria `idempotencyKey` e il CRM la riconosce.
   */
  async drainDue(limit = CRM_DRAIN_BATCH): Promise<CrmDrainSummary> {
    const now = this.deps.clock.nowIso();
    const dovuti = await this.deps.outbox.listDue(now, limit);
    let attempted = 0;
    let sent = 0;
    let queued = 0;
    let givenUp = 0;
    for (const evento of dovuti) {
      const esito = await this.attempt(evento, this.deps.ids.next());
      attempted += 1;
      if (esito.outcome === 'SENT') {
        sent += 1;
      } else if (esito.outcome === 'GIVEN_UP') {
        givenUp += 1;
      } else {
        queued += 1;
      }
    }
    const riepilogo: CrmDrainSummary = { attempted, sent, queued, givenUp };
    if (attempted > 0) {
      this.logger.info('coda di uscita: passata completata', { ...riepilogo });
    }
    return riepilogo;
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
   * Scrive l'evento nella coda di uscita e tenta subito la consegna. Non lancia mai: qualunque
   * guasto lascia la riga in coda, pronta per il rinvio, e viene solo segnalato nei log.
   */
  private async deliver(input: {
    readonly type: CrmEventType;
    readonly idempotencyKey: string;
    readonly appointment: Appointment;
    readonly payload: CrmPayload;
    readonly operatorNote: string | null;
    readonly correlationId: string;
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
          payload: { ...input.payload },
          operatorNote: input.operatorNote,
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

      return await this.attempt(evento, input.correlationId);
    } catch (cause) {
      this.logger.error(`${input.type} ${input.appointment.code}: consegna al CRM interrotta`, {
        message: cause instanceof Error ? cause.message : String(cause),
      });
      return { outcome: 'QUEUED', event: null };
    }
  }

  /** Un tentativo di consegna su un evento già in coda, con aggiornamento dello stato. */
  private async attempt(
    evento: CrmOutboxEvent,
    correlationId: string,
    options: { readonly manuale?: boolean } = {},
  ): Promise<CrmDelivery> {
    const etichetta =
      typeof evento.payload['code'] === 'string' ? evento.payload['code'] : evento.id;
    let risultato: ProviderResult<CrmAckDto>;
    try {
      risultato = await this.send(evento, {
        correlationId,
        timeoutMs: this.deps.callTimeoutMs ?? CRM_CALL_TIMEOUT_MS,
      });
    } catch (cause) {
      this.logger.error(`${evento.type} ${etichetta}: consegna al CRM interrotta`, {
        message: cause instanceof Error ? cause.message : String(cause),
      });
      return { outcome: 'QUEUED', event: evento };
    }

    const tentativi = evento.attemptCount + 1;
    if (!risultato.ok) {
      // Tentativi esauriti o rifiuto definitivo: si smette di riprovare da soli. La riga resta
      // FAILED e visibile nel pannello Sistema, dove una persona decide se insistere.
      const definitivo = !risultato.error.retryable || tentativi >= CRM_MAX_ATTEMPTS;
      const aggiornato = await this.deps.outbox.update({
        ...evento,
        status: definitivo ? 'FAILED' : 'PENDING',
        attemptCount: tentativi,
        lastError: `${risultato.error.code}: ${risultato.error.message}`,
        nextAttemptAt: definitivo ? null : this.nextAttemptAt(tentativi),
      });
      this.publishChanged(aggiornato, correlationId);
      this.logger.warn(
        `${evento.type} ${etichetta}: ${definitivo ? 'consegna abbandonata' : 'CRM non raggiungibile, evento in coda di rinvio'}`,
        { errore: risultato.error.code, tentativi, manuale: options.manuale === true },
      );
      return { outcome: definitivo ? 'GIVEN_UP' : 'QUEUED', event: aggiornato };
    }

    const inviato = await this.deps.outbox.update({
      ...evento,
      status: 'SENT',
      attemptCount: tentativi,
      crmAckId: risultato.value.ackId,
      sentAt: this.deps.clock.nowIso(),
      nextAttemptAt: null,
      lastError: null,
    });
    this.publishChanged(inviato, correlationId);
    this.logger.info(`${evento.type} ${etichetta}: inviato al CRM`, {
      ackId: risultato.value.ackId,
      tentativi,
    });
    return { outcome: 'SENT', event: inviato };
  }

  /**
   * Rispedisce il payload salvato, scegliendo il metodo dal tipo di evento. Il payload è quello
   * archiviato al momento del fatto: una pratica modificata dopo non cambia ciò che il CRM riceve.
   */
  private send(evento: CrmOutboxEvent, options: CallOptions): Promise<ProviderResult<CrmAckDto>> {
    const payload = evento.payload as unknown;
    switch (evento.type) {
      case 'NO_SHOW':
        return this.deps.crm.notifyNoShow(payload as CrmNoShowPayloadDto, options);
      case 'CHECK_IN':
        return this.deps.crm.notifyCheckIn(payload as CrmCheckInPayloadDto, options);
      case 'ANOMALY':
        return this.deps.crm.notifyAnomaly(payload as CrmAnomalyPayloadDto, options);
    }
  }

  /** Momento del prossimo tentativo: attesa progressiva 1, 5, 15, 60, 240 minuti. */
  private nextAttemptAt(tentativi: number): IsoDateTime {
    const indice = Math.min(Math.max(0, tentativi - 1), CRM_RETRY_BACKOFF_MINUTES.length - 1);
    const minuti = CRM_RETRY_BACKOFF_MINUTES[indice] ?? 1;
    return new Date(this.deps.clock.now().getTime() + minuti * 60_000).toISOString() as IsoDateTime;
  }

  private publishChanged(evento: CrmOutboxEvent, correlationId: string): void {
    this.deps.eventBus?.publish({
      id: this.deps.ids.next(),
      occurredAt: this.deps.clock.nowIso(),
      correlationId,
      actor: { kind: 'SYSTEM', id: null },
      type: 'CRM_EVENT_CHANGED',
      eventId: evento.id,
      status: evento.status,
    });
  }
}
