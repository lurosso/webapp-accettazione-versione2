// Schermata Comunicazioni: i messaggi al cliente che non sono arrivati e che qualcuno deve
// sistemare. Tre casi, una lista sola:
// - FAILED con riprova programmata: il sistema ci sta ancora provando (1, 5, 15 minuti) e lo dice;
// - FAILED senza riprova, MANUAL_REQUIRED: i canali automatici hanno finito, serve una telefonata;
// - NO_RECIPIENT: in agenda non c'è un numero, il cliente va informato di persona.
//
// Chi lavora la lista prende in carico il contatto («Prendo io», così due colleghi non chiamano la
// stessa persona), riprova l'invio se il guasto è passato, oppure registra com'è andata e chiude.
// Le regole su stati e passaggi stanno nell'orchestratore: qui si traduce per la schermata.
import { COMMUNICATIONS_LOOKBACK_DAYS } from '@/config/constants';
import type { AppointmentStatus } from '@/domain/entities/appointment';
import { customerFullName } from '@/domain/entities/customer';
import {
  MANUAL_CONTACT_OUTCOME_LABELS,
  type ManualContactOutcome,
  type NotificationChannel,
  type NotificationJob,
  type NotificationJobStatus,
  type NotificationKind,
} from '@/domain/entities/notification';
import { domainError, type DomainError } from '@/domain/errors';
import type { NotificationJobId, OperatorId } from '@/domain/ids';
import { err, ok, type Result } from '@/domain/result';
import type { IsoDate, IsoDateTime } from '@/domain/value-objects/iso-date';
import { addDays } from '@/lib/dates';
import type {
  IAppointmentRepository,
  INotificationRepository,
  IOperatorRepository,
} from '@/repositories/interfaces';
import type { IClock } from '@/services/interfaces/IClock';
import type { ILogger } from '@/services/interfaces/ILogger';
import type { CommunicationActor, NotificationOrchestrator } from './NotificationOrchestrator';

/** Una riga della schermata: il messaggio non arrivato e la pratica a cui si riferisce. */
export interface CommunicationRowView {
  readonly jobId: string;
  readonly kind: NotificationKind;
  readonly status: NotificationJobStatus;
  readonly channel: NotificationChannel | null;
  readonly appointmentId: string;
  readonly code: string;
  readonly businessDate: IsoDate;
  readonly scheduledAt: IsoDateTime | null;
  readonly appointmentStatus: AppointmentStatus | null;
  readonly customerName: string | null;
  /** Il numero da chiamare (quello a cui il messaggio non è arrivato); null se non c'è. */
  readonly phone: string | null;
  readonly plate: string | null;
  /** Il testo del messaggio: è quello che il cliente doveva leggere, e che va detto a voce. */
  readonly renderedText: string;
  readonly attemptCount: number;
  /** L'ultimo errore dei provider, in chiaro, per capire se ha senso riprovare. */
  readonly lastError: string | null;
  readonly autoRetryCount: number;
  /** Prossimo tentativo automatico; null se non ce ne sono più. */
  readonly nextAttemptAt: IsoDateTime | null;
  readonly claimedByName: string | null;
  readonly claimedByMe: boolean;
  readonly claimedAt: IsoDateTime | null;
  readonly manualOutcome: ManualContactOutcome | null;
  readonly manualOutcomeLabel: string | null;
  readonly manualNote: string | null;
  readonly confirmedByName: string | null;
  readonly confirmedAt: IsoDateTime | null;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export interface CommunicationsView {
  readonly rows: readonly CommunicationRowView[];
  /** Da gestire a mano adesso (niente riprova automatica in vista). */
  readonly openCount: number;
  /** Il sistema sta ancora riprovando da solo. */
  readonly retryingCount: number;
  /** Chiuse oggi a mano. */
  readonly handledTodayCount: number;
}

export type CommunicationsFilter = 'open' | 'handled';

export type CommunicationAction =
  | { readonly action: 'claim' }
  | { readonly action: 'release' }
  | { readonly action: 'retry' }
  | {
      readonly action: 'confirm';
      readonly outcome: ManualContactOutcome;
      readonly note: string | null;
    };

export interface CommunicationsServiceDeps {
  readonly notifications: INotificationRepository;
  readonly appointments: IAppointmentRepository;
  readonly operators: IOperatorRepository;
  readonly orchestrator: NotificationOrchestrator;
  readonly clock: IClock;
  readonly logger: ILogger;
}

const APERTI: readonly NotificationJobStatus[] = ['FAILED', 'MANUAL_REQUIRED', 'NO_RECIPIENT'];

/** Nota massima all'esito: basta per «ha detto che arriva alle 11», non per un verbale. */
const MAX_NOTE = 500;

export class CommunicationsService {
  private readonly logger: ILogger;

  constructor(private readonly deps: CommunicationsServiceDeps) {
    this.logger = deps.logger.child('[Comunicazioni]');
  }

  /** Le righe della schermata degli ultimi giorni, con i conteggi dell'intestazione. */
  async list(
    filter: CommunicationsFilter,
    viewer: { readonly operatorId: OperatorId },
  ): Promise<CommunicationsView> {
    const oggi = this.deps.clock.today();
    const dal = addDays(oggi, -COMMUNICATIONS_LOOKBACK_DAYS);
    const tutti = (
      await this.deps.notifications.listByStatus([...APERTI, 'MANUAL_CONFIRMED'])
    ).filter((j) => j.businessDate >= dal);

    const aperti = tutti.filter((j) => APERTI.includes(j.status));
    const gestiti = tutti.filter((j) => j.status === 'MANUAL_CONFIRMED');
    const scelti = filter === 'open' ? aperti : gestiti;

    const righe = await Promise.all(scelti.map((j) => this.toRow(j, viewer.operatorId)));
    righe.sort(filter === 'open' ? ordineAperti : ordineGestiti);

    return {
      rows: righe,
      openCount: aperti.filter((j) => !inRiprova(j)).length,
      retryingCount: aperti.filter(inRiprova).length,
      handledTodayCount: gestiti.filter((j) => (j.manualConfirmedAt ?? '').startsWith(oggi)).length,
    };
  }

  /** Esegue un comando della schermata sulla comunicazione e restituisce la riga aggiornata. */
  async act(
    jobId: NotificationJobId,
    command: CommunicationAction,
    actor: CommunicationActor,
  ): Promise<Result<CommunicationRowView, DomainError>> {
    // «Prendo io» vale: riprovare o chiudere il contatto preso da un collega è suo compito, salvo
    // un responsabile o un amministratore (che può anche rilasciarlo).
    if (command.action === 'retry' || command.action === 'confirm') {
      const job = await this.deps.notifications.findJobById(jobId);
      if (
        job !== null &&
        job.claimedByOperatorId !== null &&
        job.claimedByOperatorId !== actor.operatorId &&
        !actor.privileged
      ) {
        return err(
          domainError(
            'VERSION_CONFLICT',
            `La comunicazione è in carico a ${job.claimedByName ?? 'un collega'}.`,
            { claimedBy: job.claimedByName },
          ),
        );
      }
    }
    let esito: Result<NotificationJob, DomainError>;
    switch (command.action) {
      case 'claim':
        esito = await this.deps.orchestrator.claim(jobId, actor);
        break;
      case 'release':
        esito = await this.deps.orchestrator.release(jobId, actor);
        break;
      case 'retry': {
        const job = await this.deps.notifications.findJobById(jobId);
        if (job === null) {
          return err(domainError('NOT_FOUND', `Notifica non trovata: ${jobId}.`));
        }
        if (job.status === 'NO_RECIPIENT') {
          return err(
            domainError(
              'NO_RECIPIENT',
              'In agenda non c’è un numero: il cliente va informato di persona.',
            ),
          );
        }
        // Come per la riprova automatica: un messaggio di un giorno passato non si rimanda più.
        if (job.businessDate < this.deps.clock.today()) {
          return err(
            domainError(
              'INVALID_TRANSITION',
              'Il messaggio era per una giornata già passata: non ha più senso rimandarlo. Contatta il cliente se serve e registra l’esito.',
              { businessDate: job.businessDate },
            ),
          );
        }
        const run = await this.deps.orchestrator.retry(jobId);
        esito = run.ok ? ok(run.value.job) : run;
        break;
      }
      case 'confirm': {
        const nota = command.note?.trim() ?? '';
        if (nota.length > MAX_NOTE) {
          return err(
            domainError('VALIDATION', `La nota è troppo lunga (massimo ${MAX_NOTE} caratteri).`),
          );
        }
        esito = await this.deps.orchestrator.confirmManual(jobId, actor.operatorId, nota, {
          outcome: command.outcome,
          operatorName: actor.displayName,
        });
        break;
      }
    }
    if (!esito.ok) {
      return esito;
    }
    this.logger.info(`comunicazione ${esito.value.code}: ${command.action}`, {
      jobId,
      operatorId: actor.operatorId,
      stato: esito.value.status,
    });
    return ok(await this.toRow(esito.value, actor.operatorId));
  }

  private async toRow(job: NotificationJob, viewerId: OperatorId): Promise<CommunicationRowView> {
    const [appointment, conferma] = await Promise.all([
      this.deps.appointments.findById(job.appointmentId),
      job.manualConfirmedBy === null
        ? Promise.resolve(null)
        : this.deps.operators.findById(job.manualConfirmedBy),
    ]);
    const ultimoErrore = [...job.attempts]
      .reverse()
      .find((a) => a.outcome === 'FAILED' && a.errorMessage !== null);
    return {
      jobId: job.id,
      kind: job.kind,
      status: job.status,
      channel: job.currentChannel,
      appointmentId: job.appointmentId,
      code: job.code,
      businessDate: job.businessDate,
      scheduledAt: appointment?.scheduledAt ?? null,
      appointmentStatus: appointment?.status ?? null,
      customerName: appointment === null ? null : customerFullName(appointment.customer),
      phone: job.recipientPhone,
      plate: appointment?.vehicle.plate ?? null,
      renderedText: job.renderedText,
      attemptCount: job.attempts.filter((a) => a.channel !== 'MANUAL').length,
      lastError:
        ultimoErrore === undefined
          ? null
          : `${ultimoErrore.channel === 'SMS' ? 'SMS' : 'WhatsApp'}: ${ultimoErrore.errorMessage ?? ''}`,
      autoRetryCount: job.autoRetryCount,
      nextAttemptAt: job.status === 'FAILED' ? job.nextAttemptAt : null,
      claimedByName: job.claimedByName,
      claimedByMe: job.claimedByOperatorId === viewerId,
      claimedAt: job.claimedAt,
      manualOutcome: job.manualOutcome,
      manualOutcomeLabel:
        job.manualOutcome === null ? null : MANUAL_CONTACT_OUTCOME_LABELS[job.manualOutcome],
      manualNote: job.manualNote,
      confirmedByName:
        job.status === 'MANUAL_CONFIRMED' ? (conferma?.displayName ?? job.claimedByName) : null,
      confirmedAt: job.manualConfirmedAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }
}

/** FAILED con un tentativo automatico ancora in vista: il sistema ci sta pensando da solo. */
function inRiprova(job: NotificationJob): boolean {
  return job.status === 'FAILED' && job.nextAttemptAt !== null;
}

/** Prima quello che serve una persona, poi quello che il sistema sta ritentando; i più recenti in cima. */
function ordineAperti(a: CommunicationRowView, b: CommunicationRowView): number {
  const pesoA = a.nextAttemptAt === null ? 0 : 1;
  const pesoB = b.nextAttemptAt === null ? 0 : 1;
  if (pesoA !== pesoB) {
    return pesoA - pesoB;
  }
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
}

function ordineGestiti(a: CommunicationRowView, b: CommunicationRowView): number {
  const da = a.confirmedAt ?? a.updatedAt;
  const db = b.confirmedAt ?? b.updatedAt;
  return da < db ? 1 : da > db ? -1 : 0;
}
