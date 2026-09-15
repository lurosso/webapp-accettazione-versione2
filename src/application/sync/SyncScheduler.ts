// Scheduler della giornata operativa: la apre, manda i promemoria e la chiude.
// - alle SYNC_HOUR_LOCAL (default 06:00, fuso dell'officina) esegue la sync se la giornata non ha
//   ancora una sync avviata oggi; all'avvio del processo fa il "catch-up" (server riavviato alle
//   09:00 → sync immediata);
// - alle REMINDER_SAME_DAY_HOUR_LOCAL (default 07:30) manda il promemoria del giorno stesso, dopo
//   che la sync di oggi è riuscita; alle REMINDER_PREVIOUS_DAY_HOUR_LOCAL (default 18:00) anticipa
//   la sync di domani e manda il promemoria del giorno prima. Una volta al giorno ciascuno;
// - dopo BUSINESS_DAY_END_TIME (default 19:00) chiude la giornata, se è rimasto qualcosa di aperto
//   e il responsabile non l'ha già chiusa a mano.
// Un solo timer per processo. La chiusura automatica è deliberatamente prudente: una volta sola
// al giorno e solo se c'è davvero qualcosa da chiudere, perché tocca decine di pratiche e in quel
// momento non la sta guardando nessuno.
import { SYNC_RETRY_BACKOFF_MINUTES } from '@/config/constants';
import { ACTIVE_QUEUE_STATUSES } from '@/domain/entities/appointment';
import type { SyncRun } from '@/domain/entities/sync-run';
import type { IsoDate } from '@/domain/value-objects/iso-date';
import { localTimeHHmm, toBusinessDate } from '@/lib/dates';
import type { IAppointmentRepository, ISyncRunRepository } from '@/repositories/interfaces';
import type { IClock } from '@/services/interfaces/IClock';
import type { ILogger } from '@/services/interfaces/ILogger';
import type { InspectionArchiveService } from '../media/InspectionArchiveService';
import type { AppointmentReminderService } from '../notifications/AppointmentReminderService';
import { SYSTEM_ACTOR_ID, type QueueService } from '../queue/QueueService';
import type { SyncService } from './SyncService';

export interface SyncSchedulerDeps {
  readonly syncService: SyncService;
  readonly syncRuns: ISyncRunRepository;
  /** Servono alla chiusura di fine turno. */
  readonly queueService: QueueService;
  readonly appointments: IAppointmentRepository;
  /** Retention delle foto: gira dopo il fine turno, quando l'officina non carica più nulla. */
  readonly archive: InspectionArchiveService;
  readonly clock: IClock;
  readonly logger: ILogger;
  /** Ora locale "HH:mm" (env SYNC_HOUR_LOCAL). */
  readonly syncHourLocal: string;
  /** Ora locale "HH:mm" di fine turno (env BUSINESS_DAY_END_TIME). */
  readonly businessDayEndLocal: string;
  readonly timeZone: string;
  /** Intervallo del tick in ms (default 60 s). */
  readonly tickMs?: number;
  /**
   * Promemoria ai clienti (giorno prima, giorno stesso). Facoltativi: senza, lo scheduler fa solo
   * sync e chiusura, come prima del modulo C.
   */
  readonly reminders?: AppointmentReminderService;
  /** Ora locale "HH:mm" del promemoria del giorno prima (env REMINDER_PREVIOUS_DAY_HOUR_LOCAL). */
  readonly reminderPreviousDayHourLocal?: string;
  /** Ora locale "HH:mm" del promemoria del giorno stesso (env REMINDER_SAME_DAY_HOUR_LOCAL). */
  readonly reminderSameDayHourLocal?: string;
}

const DEFAULT_TICK_MS = 60_000;

export class SyncScheduler {
  private readonly logger: ILogger;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  /** Giornata per cui la chiusura automatica è già stata valutata: si fa una volta sola. */
  private lastClosedDate: IsoDate | null = null;
  /** Nuovi tentativi automatici già fatti per una sync fallita, per giornata. */
  private readonly syncRetries = new Map<IsoDate, number>();
  /** Giornata in cui la retention delle foto è già stata eseguita. */
  private lastPurgedDate: IsoDate | null = null;
  /** Giornate in cui i promemoria sono già partiti (uno per tipo). */
  private lastSameDayReminderDate: IsoDate | null = null;
  private lastPreviousDayReminderDate: IsoDate | null = null;

  constructor(private readonly deps: SyncSchedulerDeps) {
    this.logger = deps.logger.child('[Scheduler]');
  }

  /** Avvia il timer (idempotente) ed esegue subito un tick di catch-up. Restituisce lo stop. */
  start(): () => void {
    if (this.timer === null) {
      this.timer = setInterval(() => {
        void this.tick('SCHEDULED');
      }, this.deps.tickMs ?? DEFAULT_TICK_MS);
      this.logger.info('avviato', {
        syncHourLocal: this.deps.syncHourLocal,
        businessDayEndLocal: this.deps.businessDayEndLocal,
        promemoriaGiornoPrima: this.deps.reminders ? this.deps.reminderPreviousDayHourLocal : 'no',
        promemoriaGiornoStesso: this.deps.reminders ? this.deps.reminderSameDayHourLocal : 'no',
        timeZone: this.deps.timeZone,
      });
      void this.tick('BOOTSTRAP');
    }
    return () => this.stop();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Un tick: se l'ora locale ha superato SYNC_HOUR_LOCAL e la giornata non ha ancora una sync
   * avviata oggi, la esegue. Una sync anticipata la sera prima (promemoria del giorno prima) non
   * conta: l'agenda può cambiare durante la notte e la mattina si rilegge. Le sync fallite vengono
   * ritentate con attesa crescente, poi resta il pulsante "Riprova" della dashboard.
   */
  async tick(trigger: 'SCHEDULED' | 'BOOTSTRAP'): Promise<void> {
    if (this.ticking) {
      return;
    }
    this.ticking = true;
    try {
      const now = this.deps.clock.now();
      const today: IsoDate = this.deps.clock.today();
      const oraLocale = localTimeHHmm(now, this.deps.timeZone);

      await this.closeBusinessDayIfDue(today, oraLocale);
      await this.purgeExpiredMediaIfDue(today, oraLocale);
      await this.sendPreviousDayRemindersIfDue(today, oraLocale);

      if (oraLocale < this.deps.syncHourLocal) {
        return;
      }
      const latest = await this.deps.syncRuns.findLatest(today);
      if (latest === null || this.startedBefore(latest, today)) {
        this.logger.info(`nessuna sync avviata oggi per ${today}: avvio ${trigger}`);
        await this.deps.syncService.runDailySync(today, trigger);
        return;
      }
      await this.retryFailedSyncIfDue(today, latest, now);
      await this.sendSameDayRemindersIfDue(today, oraLocale, latest);
    } catch (error) {
      this.logger.error('tick fallito', {
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.ticking = false;
    }
  }

  /** La sync è stata avviata in una giornata precedente (anticipo della sera prima). */
  private startedBefore(run: SyncRun, today: IsoDate): boolean {
    return toBusinessDate(new Date(run.startedAt), this.deps.timeZone) < today;
  }

  /**
   * Sync fallita (Infinity irraggiungibile): si riprova da soli con attesa crescente, per un
   * numero finito di volte. Prima, una sync fallita alle 06:00 restava tale finché qualcuno non
   * premeva "Riprova" in dashboard: se il DMS ripartiva alle 06:10, l'officina apriva senza agenda
   * per pura distrazione. Esauriti i tentativi resta il pulsante, che è la via manuale prevista.
   */
  private async retryFailedSyncIfDue(today: IsoDate, latest: SyncRun, now: Date): Promise<void> {
    if (latest.status !== 'FAILED' || latest.finishedAt === null) {
      return;
    }
    const fatti = this.syncRetries.get(today) ?? 0;
    const attesaMinuti = SYNC_RETRY_BACKOFF_MINUTES[fatti];
    if (attesaMinuti === undefined) {
      return;
    }
    const trascorsiMs = now.getTime() - new Date(latest.finishedAt).getTime();
    if (trascorsiMs < attesaMinuti * 60_000) {
      return;
    }
    this.syncRetries.set(today, fatti + 1);
    this.logger.warn(
      `sync fallita per ${today} (${latest.errorCode ?? 'errore'}): nuovo tentativo automatico ${fatti + 1}/${SYNC_RETRY_BACKOFF_MINUTES.length}`,
    );
    await this.deps.syncService.runDailySync(today, 'RETRY');
  }

  /**
   * Promemoria del giorno stesso: una volta al giorno, dall'ora configurata, solo se la sync di
   * oggi è riuscita (con una sync fallita non c'è agenda da ricordare: si riprova al tick dopo).
   */
  private async sendSameDayRemindersIfDue(
    today: IsoDate,
    oraLocale: string,
    latest: SyncRun,
  ): Promise<void> {
    const reminders = this.deps.reminders;
    const ora = this.deps.reminderSameDayHourLocal;
    if (reminders === undefined || ora === undefined || oraLocale < ora) {
      return;
    }
    if (this.lastSameDayReminderDate === today) {
      return;
    }
    if (latest.status === 'RUNNING' || latest.status === 'FAILED') {
      return;
    }
    this.lastSameDayReminderDate = today;
    const esito = await reminders.sendSameDayReminders(today);
    this.logger.info('promemoria del giorno stesso eseguiti', { ...esito });
  }

  /**
   * Promemoria del giorno prima: una volta al giorno, dall'ora configurata. Il servizio anticipa
   * la sync di domani e poi manda i messaggi a chi è in attesa domani.
   */
  private async sendPreviousDayRemindersIfDue(today: IsoDate, oraLocale: string): Promise<void> {
    const reminders = this.deps.reminders;
    const ora = this.deps.reminderPreviousDayHourLocal;
    if (reminders === undefined || ora === undefined || oraLocale < ora) {
      return;
    }
    if (this.lastPreviousDayReminderDate === today) {
      return;
    }
    // Segnata subito: un errore non deve far ripartire il giro a ogni minuto fino a mezzanotte.
    this.lastPreviousDayReminderDate = today;
    const esito = await reminders.sendPreviousDayReminders(today);
    this.logger.info('promemoria del giorno prima eseguiti', { ...esito });
  }

  /**
   * Retention delle foto: una volta al giorno, dopo il fine turno, quando nessun tablet sta
   * caricando. Elimina i file scaduti e marca i record come archiviati.
   */
  private async purgeExpiredMediaIfDue(today: IsoDate, oraLocale: string): Promise<void> {
    if (oraLocale < this.deps.businessDayEndLocal || this.lastPurgedDate === today) {
      return;
    }
    this.lastPurgedDate = today;
    const esito = await this.deps.archive.purgeExpired();
    if (esito.examined > 0) {
      this.logger.info('retention foto eseguita', { ...esito });
    }
  }

  /**
   * Chiusura di fine turno: una volta per giornata e solo se qualcosa è rimasto aperto. Se il
   * responsabile ha già chiuso a mano non c'è nulla da fare, e un secondo evento di chiusura
   * direbbe soltanto la stessa cosa.
   */
  private async closeBusinessDayIfDue(today: IsoDate, oraLocale: string): Promise<void> {
    if (oraLocale < this.deps.businessDayEndLocal || this.lastClosedDate === today) {
      return;
    }
    // Segnata subito: se la chiusura fallisce non si riprova a ogni minuto fino a mezzanotte.
    // Resta il pulsante del responsabile, che è la via manuale prevista.
    this.lastClosedDate = today;

    const aperte = await this.deps.appointments.listByDate(today, {
      statuses: [...ACTIVE_QUEUE_STATUSES, 'IN_PROGRESS'],
    });
    if (aperte.length === 0) {
      this.logger.info('fine turno: giornata gia chiusa', { giornata: today });
      return;
    }

    this.logger.info('fine turno: chiusura automatica', { giornata: today, aperte: aperte.length });
    const esito = await this.deps.queueService.closeBusinessDay(today, {
      operatorId: SYSTEM_ACTOR_ID,
      workstationId: null,
      correlationId: null,
      actorKind: 'SYSTEM',
    });
    if (!esito.ok) {
      this.logger.error('chiusura automatica non riuscita', { errore: esito.error.code });
      return;
    }
    this.logger.info('chiusura automatica completata', {
      assenti: esito.value.noShow.length,
      chiuseDUfficio: esito.value.autoClosed.length,
      nonRiuscite: esito.value.failed.length,
    });
  }
}
