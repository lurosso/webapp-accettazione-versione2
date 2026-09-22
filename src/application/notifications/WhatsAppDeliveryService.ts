// Lo stato dell'ultimo WhatsApp sulla pratica, da due direzioni:
// - in USCITA, ogni volta che l'orchestratore salva un job sul canale WhatsApp, lo specchio sulla
//   pratica (`Appointment.whatsapp`) si aggiorna: così coda e archivio dicono «WhatsApp inviato»
//   appena il messaggio parte, senza aspettare Spoki;
// - in ENTRATA, il webhook di esito di Spoki (inviato, consegnato, letto, fallito) ritrova il
//   job del messaggio e lo porta avanti, e lo specchio segue.
//
// Ritrovare il messaggio non è banale: Spoki risponde all'invio senza corpo, quindi l'id che
// abbiamo può essere quello generato da noi. Si prova nell'ordine: l'id del messaggio nei
// tentativi, la chiave di idempotenza nei metadati che avevamo allegato, e infine il numero del
// destinatario fra i WhatsApp recenti. Un esito che non trova nulla è `handled: false`, mai un
// errore: il provider ritenterebbe, e ritentare non cambierebbe niente.
import type { WhatsAppDelivery } from '@/domain/entities/appointment';
import type { NotificationJob } from '@/domain/entities/notification';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import type { IAppointmentRepository } from '@/repositories/interfaces/IAppointmentRepository';
import type { INotificationRepository } from '@/repositories/interfaces/INotificationRepository';
import type { SpokiWebhookEvent } from '@/services/dto/spoki-webhook.dto';
import type { IClock } from '@/services/interfaces/IClock';
import type { ILogger } from '@/services/interfaces/ILogger';
import type { NotificationOrchestrator, WhatsAppDeliverySink } from './NotificationOrchestrator';

/** Esito di consegna come arriva dal webhook (la variante DELIVERY dell'evento normalizzato). */
export type DeliveryEvent = Extract<SpokiWebhookEvent, { kind: 'DELIVERY' }>;

export type ApplyDeliveryOutcome =
  | { readonly handled: true; readonly job: NotificationJob; readonly duplicate: boolean }
  | { readonly handled: false; readonly reason: 'UNKNOWN_MESSAGE' | 'DUPLICATE_EVENT' };

export interface WhatsAppDeliveryServiceDeps {
  readonly appointments: IAppointmentRepository;
  readonly notifications: INotificationRepository;
  readonly orchestrator: NotificationOrchestrator;
  readonly clock: IClock;
  readonly logger: ILogger;
}

/** Quanti eventi si ricordano per scartare i ritenti del provider. */
const MAX_SEEN_EVENTS = 5_000;

/**
 * Chiave di un evento ai fini dei ritenti: identificativo E stato. Spoki può usare per un
 * messaggio lo stesso `event_uuid` a ogni passaggio (inviato, consegnato, letto): il solo id
 * scarterebbe la progressione. Un ritento vero ha stessa chiave e stesso stato.
 */
function chiaveEvento(event: DeliveryEvent): string | null {
  return event.eventId === null ? null : `${event.eventId}|${event.state}`;
}

/**
 * Stato WhatsApp della pratica a partire dal job: lo stato del job se il canale corrente è
 * WhatsApp; `FAILED` se WhatsApp è stato tentato ed è poi subentrato un altro canale (SMS o
 * contatto manuale); null se WhatsApp non è mai stato tentato.
 */
export function whatsappDeliveryFromJob(job: NotificationJob): WhatsAppDelivery | null {
  const tentativi = job.attempts.filter((a) => a.channel === 'WHATSAPP');
  const ultimo = tentativi[tentativi.length - 1];
  if (ultimo === undefined) {
    return null;
  }
  const base = {
    kind: job.kind,
    at: job.updatedAt,
    providerMessageId: ultimo.providerMessageId,
  };
  if (job.currentChannel !== 'WHATSAPP') {
    return { ...base, state: 'FAILED' };
  }
  switch (job.status) {
    case 'SENT':
    case 'IN_FLIGHT':
    case 'PENDING':
      return { ...base, state: 'SENT' };
    case 'DELIVERED':
      return { ...base, state: 'DELIVERED' };
    case 'READ':
      return { ...base, state: 'READ' };
    case 'FAILED':
    case 'MANUAL_REQUIRED':
      return { ...base, state: 'FAILED' };
    case 'MANUAL_CONFIRMED':
    case 'NO_RECIPIENT':
    case 'SUPPRESSED':
      return null;
  }
}

/** Specchio sulla pratica: lo usa l'orchestratore ogni volta che salva un job WhatsApp. */
export class AppointmentWhatsAppMirror implements WhatsAppDeliverySink {
  constructor(
    private readonly appointments: IAppointmentRepository,
    private readonly logger: ILogger,
  ) {}

  async recordFromJob(job: NotificationJob): Promise<void> {
    const delivery = whatsappDeliveryFromJob(job);
    if (delivery === null) {
      return;
    }
    const aggiornata = await this.appointments.updateWhatsAppDelivery(job.appointmentId, delivery);
    if (aggiornata === null) {
      this.logger.warn('stato WhatsApp non specchiato: pratica non trovata', {
        appointmentId: job.appointmentId,
        jobId: job.id,
      });
    }
  }
}

export class WhatsAppDeliveryService {
  private readonly logger: ILogger;
  private readonly seenEvents = new Set<string>();

  constructor(private readonly deps: WhatsAppDeliveryServiceDeps) {
    this.logger = deps.logger.child('[WhatsApp][Esiti]');
  }

  /** Applica un esito di consegna arrivato dal webhook al job che lo riguarda (e alla pratica). */
  async applyDelivery(event: DeliveryEvent, correlationId: string): Promise<ApplyDeliveryOutcome> {
    const chiave = chiaveEvento(event);
    if (chiave !== null && this.seenEvents.has(chiave)) {
      this.logger.debug('esito già applicato: ritento del provider ignorato', {
        eventId: event.eventId,
        state: event.state,
      });
      return { handled: false, reason: 'DUPLICATE_EVENT' };
    }

    const job = await this.findJob(event);
    if (job === null) {
      this.logger.warn('esito WhatsApp per un messaggio sconosciuto', {
        providerMessageId: event.providerMessageId,
        state: event.state,
        correlationId,
      });
      return { handled: false, reason: 'UNKNOWN_MESSAGE' };
    }

    const at: IsoDateTime = event.occurredAt ?? this.deps.clock.nowIso();
    const aggiornato = await this.deps.orchestrator.applyDeliveryStatus(
      job,
      {
        providerMessageId: event.providerMessageId,
        state: event.state,
        reason: event.reason,
        at,
      },
      correlationId,
    );
    // Si ricorda solo quello che è stato applicato: un esito per un messaggio ancora sconosciuto
    // deve poter tornare (per esempio dopo che l'invio ha finito di essere registrato).
    if (chiave !== null) {
      this.remember(chiave);
    }
    this.logger.info(`esito WhatsApp ${event.state} per ${job.code}`, {
      jobId: job.id,
      status: aggiornato.status,
      correlationId,
    });
    return { handled: true, job: aggiornato, duplicate: aggiornato.status === job.status };
  }

  /** Il job del messaggio: per id, per chiave di idempotenza nei metadati, infine per numero. */
  private async findJob(event: DeliveryEvent): Promise<NotificationJob | null> {
    const perId = await this.deps.notifications.findJobByProviderMessageId(event.providerMessageId);
    if (perId !== null) {
      return perId;
    }
    const chiave = event.metadata?.['idempotency_key'];
    if (typeof chiave === 'string' && chiave !== '') {
      // La chiave del tentativo è `${jobKey}:WA:${n}`: si torna alla chiave del job.
      const chiaveJob = chiave.replace(/:WA:\d+$/, '');
      const perChiave = await this.deps.notifications.findJobByIdempotencyKey(chiaveJob);
      if (perChiave !== null) {
        return perChiave;
      }
    }
    if (event.recipient !== null) {
      const recenti = await this.deps.notifications.listByStatus(
        ['IN_FLIGHT', 'SENT', 'DELIVERED', 'READ'],
        this.deps.clock.today(),
      );
      const stessoNumero = recenti.filter(
        (j) => j.currentChannel === 'WHATSAPP' && j.recipientPhone === event.recipient,
      );
      // Il più recente: è quello di cui Spoki sta parlando con ogni probabilità.
      return stessoNumero[stessoNumero.length - 1] ?? null;
    }
    return null;
  }

  private remember(chiave: string): void {
    this.seenEvents.add(chiave);
    if (this.seenEvents.size > MAX_SEEN_EVENTS) {
      const primo = this.seenEvents.values().next().value;
      if (primo !== undefined) {
        this.seenEvents.delete(primo);
      }
    }
  }
}
