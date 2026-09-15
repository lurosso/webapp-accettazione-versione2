// Messaggi al cliente guidati dagli eventi (modulo C): quando in officina succede qualcosa che il
// cliente deve sapere, parte un messaggio. Chi produce l'evento (coda, sync, chiusura) non sa
// nulla di WhatsApp: pubblica sul bus e va avanti. Questa policy ascolta e decide.
//
// Tre momenti, tre regole:
// - pratica inserita a mano al banco → conferma con il codice. Le pratiche dell'agenda Infinity
//   NON ricevono questa conferma: hanno già il promemoria del mattino, e un secondo messaggio
//   sarebbe rumore;
// - il turno si avvicina → quando davanti al cliente restano al massimo N pratiche del suo
//   sportello. Una volta sola per giornata: l'idempotenza del job lo garantisce;
// - pratica annullata o cliente segnato assente → avviso di annullamento, ma solo se a deciderlo
//   è stata una persona. La chiusura automatica delle 19:00 chiude per pulizia, e nessun cliente
//   vuole un messaggio alle 19:00 che gli dice che il suo appuntamento non c'è più.
//
// Nulla di tutto questo blocca chi ha generato l'evento: il bus consegna in modo sincrono, quindi
// il lavoro vero parte al giro successivo dell'event loop e un provider lento o giù non rallenta
// la presa in carico che l'ha innescato.
import { TURN_APPROACHING_AHEAD } from '@/config/constants';
import { ACTIVE_QUEUE_STATUSES, type Appointment } from '@/domain/entities/appointment';
import type { Brand } from '@/domain/entities/brand';
import type { NotificationKind } from '@/domain/entities/notification';
import type { DomainEvent } from '@/domain/events';
import { countAheadInSameDesk } from '@/domain/queue-position';
import type { IAppointmentRepository, IReferenceDataRepository } from '@/repositories/interfaces';
import type { IEventBus } from '@/services/interfaces/IEventBus';
import type { IIdGenerator } from '@/services/interfaces/IIdGenerator';
import type { ILogger } from '@/services/interfaces/ILogger';
import type { NotificationOrchestrator } from './NotificationOrchestrator';

export interface CustomerMessagingPolicyDeps {
  readonly eventBus: IEventBus;
  readonly appointments: IAppointmentRepository;
  readonly referenceData: IReferenceDataRepository;
  readonly orchestrator: NotificationOrchestrator;
  readonly ids: IIdGenerator;
  readonly logger: ILogger;
  /** Interruttore generale (env MESSAGING_TRIGGERS_ENABLED). */
  readonly enabled: boolean;
  /** Quante pratiche davanti fanno scattare "il turno si avvicina" (default dalla configurazione). */
  readonly turnApproachingAhead?: number;
  /**
   * Come rimandare il lavoro fuori dal chiamante. Di default un timer a zero; nei test si passa
   * una funzione che esegue subito, così le asserzioni non devono aspettare.
   */
  readonly defer?: (work: () => void) => void;
}

export class CustomerMessagingPolicy {
  private readonly logger: ILogger;
  private unsubscribe: (() => void) | null = null;
  /** Lavori in volo: `flush()` li attende nei test e allo spegnimento. */
  private readonly inFlight = new Set<Promise<void>>();

  constructor(private readonly deps: CustomerMessagingPolicyDeps) {
    this.logger = deps.logger.child('[Messaggi]');
  }

  /** Si mette in ascolto del bus (idempotente). Restituisce la funzione di arresto. */
  start(): () => void {
    if (this.unsubscribe === null && this.deps.enabled) {
      this.unsubscribe = this.deps.eventBus.subscribe((event) => this.onEvent(event));
      this.logger.info('policy messaggi attiva', {
        turnoVicinoEntro: this.deps.turnApproachingAhead ?? TURN_APPROACHING_AHEAD,
      });
    }
    return () => this.stop();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Attende i lavori in corso (test e spegnimento ordinato). */
  async flush(): Promise<void> {
    await Promise.allSettled([...this.inFlight]);
  }

  private onEvent(event: DomainEvent): void {
    const defer = this.deps.defer ?? ((work: () => void) => setTimeout(work, 0));
    // Mai lavorare dentro la pubblicazione: chi ha pubblicato deve poter rispondere subito.
    defer(() => {
      const lavoro = this.handle(event).catch((cause: unknown) => {
        this.logger.error('policy messaggi: errore non previsto', {
          evento: event.type,
          message: cause instanceof Error ? cause.message : String(cause),
        });
      });
      this.inFlight.add(lavoro);
      void lavoro.finally(() => this.inFlight.delete(lavoro));
    });
  }

  private async handle(event: DomainEvent): Promise<void> {
    switch (event.type) {
      case 'APPOINTMENT_CREATED':
        if (event.source === 'MANUAL') {
          await this.send(event.appointmentId, 'BOOKING_CONFIRMED', event.correlationId);
        }
        return;
      case 'APPOINTMENT_STATUS_CHANGED':
        if ((event.to === 'CANCELLED' || event.to === 'NO_SHOW') && event.actor.kind !== 'SYSTEM') {
          await this.send(event.appointmentId, 'APPOINTMENT_CANCELLED', event.correlationId);
        }
        // Ogni cambio di stato riordina la fila: qualcuno potrebbe essere arrivato vicino al turno.
        await this.notifyApproachingTurns(event.appointmentId, event.correlationId);
        return;
      default:
        return;
    }
  }

  /** Avvisa chi ha davanti al massimo N pratiche del proprio sportello (una volta per giornata). */
  private async notifyApproachingTurns(
    changedId: Appointment['id'],
    correlationId: string,
  ): Promise<void> {
    const cambiata = await this.deps.appointments.findById(changedId);
    if (cambiata === null) {
      return;
    }
    const [inCoda, desks] = await Promise.all([
      this.deps.appointments.listByDate(cambiata.businessDate, {
        statuses: [...ACTIVE_QUEUE_STATUSES],
      }),
      this.deps.referenceData.listDesks(),
    ]);
    const soglia = this.deps.turnApproachingAhead ?? TURN_APPROACHING_AHEAD;
    for (const a of inCoda) {
      if (a.status !== 'WAITING') {
        continue;
      }
      if (countAheadInSameDesk(a, inCoda, desks) <= soglia) {
        // Un record guasto (data malformata, marchio sconosciuto) non deve fermare gli avvisi
        // agli altri clienti in fila: si segnala e si passa al prossimo.
        try {
          await this.sendAppointment(a, 'TURN_APPROACHING', correlationId);
        } catch (cause) {
          this.logger.error(`TURN_APPROACHING per ${a.code} non inviato`, {
            message: cause instanceof Error ? cause.message : String(cause),
          });
        }
      }
    }
  }

  private async send(
    appointmentId: Appointment['id'],
    kind: NotificationKind,
    correlationId: string,
  ): Promise<void> {
    const appointment = await this.deps.appointments.findById(appointmentId);
    if (appointment === null) {
      return;
    }
    await this.sendAppointment(appointment, kind, correlationId);
  }

  private async sendAppointment(
    appointment: Appointment,
    kind: NotificationKind,
    correlationId: string,
  ): Promise<void> {
    const brand = await this.findBrand(appointment);
    if (brand === null) {
      return;
    }
    // L'orchestratore è idempotente per (pratica, tipo, giornata): richiamarlo è innocuo.
    const esito = await this.deps.orchestrator.sendReminder({
      appointment,
      brand,
      kind,
      correlationId: correlationId === '' ? this.deps.ids.next() : correlationId,
    });
    if (esito.outcome.kind !== 'ALREADY_PROCESSED') {
      this.logger.info(`${kind} per ${appointment.code}: ${esito.outcome.kind}`);
    }
  }

  private async findBrand(appointment: Appointment): Promise<Brand | null> {
    const brands = await this.deps.referenceData.listBrands();
    return brands.find((b) => b.id === appointment.brandId) ?? null;
  }
}
