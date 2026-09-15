// Promemoria programmati ai clienti (modulo C): sono le SOLE due notifiche integrate con Spoki
// in questa fase.
// - GIORNO PRIMA: nel pomeriggio si anticipa la sincronizzazione dell'agenda di domani (così le
//   pratiche esistono già con il loro codice F0xx) e a ogni cliente in attesa si manda data,
//   orario, targa, codice e link al portale;
// - GIORNO STESSO: la mattina, dopo la sync delle 06:00 e all'ora configurata, a chi è in coda
//   oggi si manda orario, targa e codice.
// L'orchestratore è idempotente per (pratica, tipo, giornata): lanciare due volte lo stesso
// promemoria è innocuo, e questo servizio può quindi essere chiamato dallo scheduler, dal cron
// esterno e dal pannello senza contarsi addosso.
//
// GUARDRAIL: questo servizio non parla con Spoki. Passa dall'orchestratore, che passa dalla porta
// `ISpokiService`; è lì (adapter) che simulazione e blocco di sicurezza impediscono qualunque
// chiamata HTTP. `liveDeliveryAllowed` entra qui solo per dirlo nel riepilogo (`dryRun`).
import type { Appointment } from '@/domain/entities/appointment';
import type { NotificationKind } from '@/domain/entities/notification';
import type { SyncRunStatus } from '@/domain/entities/sync-run';
import type { IsoDate } from '@/domain/value-objects/iso-date';
import { addDays } from '@/lib/dates';
import type { IAppointmentRepository, IReferenceDataRepository } from '@/repositories/interfaces';
import type { IClock } from '@/services/interfaces/IClock';
import type { IIdGenerator } from '@/services/interfaces/IIdGenerator';
import type { ILogger } from '@/services/interfaces/ILogger';
import type { SyncService } from '../sync/SyncService';
import type { NotificationOrchestrator, NotificationOutcome } from './NotificationOrchestrator';

/** I due promemoria del perimetro attuale. */
export type ReminderKind = Extract<NotificationKind, 'REMINDER_PREVIOUS_DAY' | 'REMINDER_SAME_DAY'>;

export const REMINDER_KINDS: readonly ReminderKind[] = [
  'REMINDER_PREVIOUS_DAY',
  'REMINDER_SAME_DAY',
];

/** Riepilogo leggibile di una passata di promemoria (log, cron, pannello). */
export interface ReminderRunSummary {
  readonly kind: ReminderKind;
  /** Giornata degli appuntamenti a cui si riferiscono i messaggi (domani per il giorno prima). */
  readonly businessDate: IsoDate;
  /** True quando nessun WhatsApp reale può partire (mock, simulazione o blocco di sicurezza). */
  readonly dryRun: boolean;
  /** Pratiche in attesa considerate. */
  readonly candidates: number;
  readonly whatsapp: number;
  readonly sms: number;
  readonly retryable: number;
  readonly manual: number;
  readonly noRecipient: number;
  readonly alreadyProcessed: number;
  /** Esito della sync anticipata di domani (solo giorno prima); null negli altri casi. */
  readonly syncStatus: SyncRunStatus | null;
  /** Motivo per cui non si è inviato nulla (promemoria disattivati, sync fallita); null se eseguito. */
  readonly skippedReason: string | null;
  readonly correlationId: string;
}

export interface AppointmentReminderServiceDeps {
  readonly appointments: IAppointmentRepository;
  readonly referenceData: IReferenceDataRepository;
  readonly orchestrator: NotificationOrchestrator;
  /** Serve al giorno prima per anticipare l'agenda di domani. */
  readonly syncService: SyncService;
  readonly clock: IClock;
  readonly ids: IIdGenerator;
  readonly logger: ILogger;
  /** Interruttore generale (env REMINDERS_ENABLED). */
  readonly enabled: boolean;
  /** True solo con Spoki reale, in live e senza blocco di sicurezza. */
  readonly liveDeliveryAllowed: boolean;
}

export class AppointmentReminderService {
  private readonly logger: ILogger;

  constructor(private readonly deps: AppointmentReminderServiceDeps) {
    this.logger = deps.logger.child('[Promemoria]');
  }

  /** Promemoria per gli appuntamenti di `businessDate` (default: oggi). */
  async sendSameDayReminders(
    businessDate: IsoDate = this.deps.clock.today(),
    correlationId: string = this.deps.ids.next(),
  ): Promise<ReminderRunSummary> {
    if (!this.deps.enabled) {
      return this.skipped('REMINDER_SAME_DAY', businessDate, null, correlationId);
    }
    return this.dispatch('REMINDER_SAME_DAY', businessDate, null, correlationId);
  }

  /**
   * Promemoria per gli appuntamenti del giorno dopo `referenceDate` (default: domani). Prima
   * anticipa la sync di quella giornata: senza, le pratiche non esisterebbero e non avrebbero codice.
   */
  async sendPreviousDayReminders(
    referenceDate: IsoDate = this.deps.clock.today(),
    correlationId: string = this.deps.ids.next(),
  ): Promise<ReminderRunSummary> {
    const target = addDays(referenceDate, 1);
    if (!this.deps.enabled) {
      return this.skipped('REMINDER_PREVIOUS_DAY', target, null, correlationId);
    }
    const run = await this.deps.syncService.runDailySync(target, 'REMINDER');
    if (run.status === 'FAILED') {
      this.logger.warn(`giorno prima: sync anticipata di ${target} fallita, nessun messaggio`, {
        errorCode: run.errorCode,
        correlationId,
      });
      return this.skipped(
        'REMINDER_PREVIOUS_DAY',
        target,
        run.status,
        correlationId,
        `sync di ${target} fallita (${run.errorCode ?? 'errore'})`,
      );
    }
    return this.dispatch('REMINDER_PREVIOUS_DAY', target, run.status, correlationId);
  }

  private async dispatch(
    kind: ReminderKind,
    businessDate: IsoDate,
    syncStatus: SyncRunStatus | null,
    correlationId: string,
  ): Promise<ReminderRunSummary> {
    // Solo chi è ancora in attesa: chi è già in carico, saltato o annullato non va ricordato.
    const [candidates, brands] = await Promise.all([
      this.deps.appointments.listByDate(businessDate, { statuses: ['WAITING'] }),
      this.deps.referenceData.listBrands(),
    ]);
    const runs = await this.deps.orchestrator.sendReminders({
      appointments: candidates,
      brands,
      kind,
      correlationId,
    });
    const count = (outcome: NotificationOutcome['kind']): number =>
      runs.filter((r) => r.outcome.kind === outcome).length;
    const summary: ReminderRunSummary = {
      kind,
      businessDate,
      dryRun: !this.deps.liveDeliveryAllowed,
      candidates: candidates.length,
      whatsapp: count('WHATSAPP_SENT'),
      sms: count('SMS_FALLBACK_SENT'),
      retryable: count('FAILED_RETRYABLE'),
      manual: count('MANUAL_REQUIRED'),
      noRecipient: count('NO_RECIPIENT'),
      alreadyProcessed: count('ALREADY_PROCESSED'),
      syncStatus,
      skippedReason: null,
      correlationId,
    };
    this.logger.info(
      `${kind} per ${businessDate}: ${summary.candidates} in attesa` +
        (summary.dryRun ? ' (DRY-RUN: nessun WhatsApp reale)' : ''),
      { ...summary },
    );
    return summary;
  }

  private skipped(
    kind: ReminderKind,
    businessDate: IsoDate,
    syncStatus: SyncRunStatus | null,
    correlationId: string,
    reason = 'promemoria disattivati (REMINDERS_ENABLED=false)',
  ): ReminderRunSummary {
    return {
      kind,
      businessDate,
      dryRun: !this.deps.liveDeliveryAllowed,
      candidates: 0,
      whatsapp: 0,
      sms: 0,
      retryable: 0,
      manual: 0,
      noRecipient: 0,
      alreadyProcessed: 0,
      syncStatus,
      skippedReason: reason,
      correlationId,
    };
  }
}

/** Solo per i log: quali pratiche riceverebbero il messaggio. */
export function reminderCandidates(appointments: readonly Appointment[]): readonly Appointment[] {
  return appointments.filter((a) => a.status === 'WAITING');
}
