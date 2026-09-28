// Lettura dei tocchi sui pulsanti del promemoria del mattino da Spoki (M8-T55).
//
// Finché l'app non ha un indirizzo https pubblico, Spoki non può chiamarla. Le tre automazioni dei
// pulsanti («ACC · Pulsante …», docs/SPOKI.md) scrivono allora il pulsante toccato nel campo
// ACC_PULSANTE del contatto (ARRIVATO, RITARDO, ASSENTE), e questo servizio lo legge a intervalli
// (SPOKI_REPLY_POLL_SECONDS). Ogni passata:
// 1. sceglie le pratiche di oggi da guardare: in coda, cliente non ancora arrivato, promemoria del
//    mattino arrivato DAVVERO su WhatsApp (non fermato dal guardrail). È quel promemoria a scrivere
//    ACC_PROMEMORIA = INVIATO, l'unico caso in cui le automazioni dei pulsanti scrivono qualcosa, e
//    ACC_PULSANTE = ATTESA, così un tocco di un altro giorno non vale per oggi;
// 2. legge ACC_PULSANTE a rotazione, dentro un budget di chiamate ricavato dall'intervallo
//    (SPOKI_REPLY_POLL_CALLS_PER_MINUTE, metà del tetto di Spoki; mai più di
//    SPOKI_REPLY_POLL_MAX_PER_TICK a passata); al primo «troppe richieste» la passata si ferma;
// 3. un valore nuovo diventa un tocco per `WhatsAppInboundService` (canale POLLING): la pratica si
//    aggiorna come con il webhook e al cliente risponde l'app. Poi si rilegge il campo e lo si
//    rimette ad ATTESA solo se vale ancora quel tocco: se nel frattempo il cliente ne ha toccato un
//    altro, resta per la passata dopo.
//
// GUARDRAIL: letture e scritture passano dalla porta Spoki, con gli stessi blocchi degli invii
// (simulazione, safety lock, demo interna). Mai bloccante: un guasto va nel log e la passata dopo
// riprova. Un azzeramento non riuscito si riprova nelle passate seguenti anche quando la pratica
// non è più da guardare (arrivata, assente), senza riapplicare il tocco; al cambio di giornata i
// conti in sospeso si azzerano.
import {
  SPOKI_REPLY_POLL_CALLS_PER_MINUTE,
  SPOKI_REPLY_POLL_MAX_PER_TICK,
} from '@/config/constants';
import type { Appointment } from '@/domain/entities/appointment';
import { effectiveScheduleTime, isInQueue } from '@/domain/entities/appointment';
import type { NotificationJob } from '@/domain/entities/notification';
import type { IsoDate, IsoDateTime } from '@/domain/value-objects/iso-date';
import { maskPhone, type PhoneE164 } from '@/domain/value-objects/phone';
import type { IAppointmentRepository } from '@/repositories/interfaces';
import type { INotificationRepository } from '@/repositories/interfaces/INotificationRepository';
import {
  SPOKI_BUTTON_FIELD,
  SPOKI_BUTTON_PAYLOADS,
  SPOKI_SIMULATED_MESSAGE_ID_PREFIX,
} from '@/services/dto/spoki.dto';
import type { IClock } from '@/services/interfaces/IClock';
import type { IIdGenerator } from '@/services/interfaces/IIdGenerator';
import type { ILogger } from '@/services/interfaces/ILogger';
import type { ISpokiService } from '@/services/interfaces/ISpokiService';
import type { WhatsAppInboundService } from './WhatsAppInboundService';

export interface SpokiReplyPollerDeps {
  readonly appointments: IAppointmentRepository;
  readonly notifications: INotificationRepository;
  readonly spoki: ISpokiService;
  readonly inbound: Pick<WhatsAppInboundService, 'handle'>;
  readonly clock: IClock;
  readonly ids: IIdGenerator;
  readonly logger: ILogger;
  /** SPOKI_REPLY_POLLING (e niente MESSAGING_STANDBY): spento, `start` e `tick` non fanno niente. */
  readonly enabled: boolean;
  /** SPOKI_REPLY_POLL_SECONDS. */
  readonly intervalSeconds: number;
  /** Chiamate a Spoki al massimo per passata (predefinito: ricavato dall'intervallo). */
  readonly maxCallsPerTick?: number;
}

/** Com'è andata una passata. */
export interface ReplyPollSummary {
  /** Contatti da guardare (pratiche di oggi con il promemoria del mattino su WhatsApp). */
  readonly watched: number;
  /** Contatti letti davvero da Spoki. */
  readonly read: number;
  /** Letture fermate dal guardrail (simulazione, safety lock, numero fuori dalla demo). */
  readonly blocked: number;
  /** Tocchi applicati alle pratiche. */
  readonly applied: number;
  readonly failed: number;
}

/** Stato della lettura per il pannello Spoki. */
export interface ReplyPollStatus {
  readonly enabled: boolean;
  readonly intervalSeconds: number;
  /** Chiamate a Spoki al massimo per passata. */
  readonly callsPerTick: number;
  /** True se il temporizzatore gira in questo processo. */
  readonly running: boolean;
  readonly lastTickAt: IsoDateTime | null;
  /** L'ultima passata. */
  readonly last: ReplyPollSummary | null;
  /** Tocchi applicati da quando il processo è partito. */
  readonly appliedTotal: number;
  readonly lastAppliedAt: IsoDateTime | null;
  readonly lastError: string | null;
  readonly lastErrorAt: IsoDateTime | null;
}

const NIENTE: ReplyPollSummary = { watched: 0, read: 0, blocked: 0, applied: 0, failed: 0 };

const INVIATO_SU_WHATSAPP: readonly NotificationJob['status'][] = ['SENT', 'DELIVERED', 'READ'];

/** Esito della lettura di un contatto e chiamate a Spoki che è costata. */
interface Lettura {
  readonly esito: 'READ' | 'BLOCKED' | 'APPLIED' | 'FAILED' | 'RATE_LIMITED';
  readonly chiamate: number;
}

/**
 * Il promemoria del mattino è arrivato davvero su WhatsApp: job su WhatsApp, inviato, e con un
 * tentativo che Spoki ha accettato (non un invio fermato dal guardrail, che non ha scritto niente sul
 * contatto).
 */
function promemoriaDelMattinoArrivato(j: NotificationJob): boolean {
  return (
    j.kind === 'REMINDER_SAME_DAY' &&
    j.currentChannel === 'WHATSAPP' &&
    INVIATO_SU_WHATSAPP.includes(j.status) &&
    j.attempts.some(
      (t) =>
        t.channel === 'WHATSAPP' &&
        t.providerMessageId !== null &&
        !t.providerMessageId.startsWith(SPOKI_SIMULATED_MESSAGE_ID_PREFIX),
    )
  );
}

export class SpokiReplyPoller {
  private readonly logger: ILogger;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  /** Dove riprende la rotazione alla passata dopo. */
  private cursor = 0;
  /** La giornata a cui si riferiscono cursore e azzeramenti in sospeso. */
  private giornata: IsoDate | null = null;
  private lastTickAt: IsoDateTime | null = null;
  private last: ReplyPollSummary | null = null;
  private appliedTotal = 0;
  private lastAppliedAt: IsoDateTime | null = null;
  private lastError: string | null = null;
  private lastErrorAt: IsoDateTime | null = null;
  /** Tocchi già applicati il cui campo non è ancora tornato ATTESA: numero → valore. */
  private readonly daAzzerare = new Map<PhoneE164, string>();

  constructor(private readonly deps: SpokiReplyPollerDeps) {
    this.logger = deps.logger.child('[Spoki][Pulsanti]');
  }

  get enabled(): boolean {
    return this.deps.enabled;
  }

  /** Avvia il temporizzatore (idempotente) ed esegue subito una passata. Restituisce lo stop. */
  start(): () => void {
    if (!this.deps.enabled) {
      return () => undefined;
    }
    if (this.timer === null) {
      this.timer = setInterval(() => {
        void this.tick();
      }, this.deps.intervalSeconds * 1000);
      this.logger.info('avviato', {
        ogniSecondi: this.deps.intervalSeconds,
        chiamatePerPassata: this.callsPerTick(),
      });
      void this.tick();
    }
    return () => this.stop();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  status(): ReplyPollStatus {
    return {
      enabled: this.deps.enabled,
      intervalSeconds: this.deps.intervalSeconds,
      callsPerTick: this.callsPerTick(),
      running: this.timer !== null,
      lastTickAt: this.lastTickAt,
      last: this.last,
      appliedTotal: this.appliedTotal,
      lastAppliedAt: this.lastAppliedAt,
      lastError: this.lastError,
      lastErrorAt: this.lastErrorAt,
    };
  }

  /** Una passata; se la precedente è ancora in corso questa si salta. */
  async tick(): Promise<ReplyPollSummary> {
    if (!this.deps.enabled || this.ticking) {
      return NIENTE;
    }
    this.ticking = true;
    try {
      const esito = await this.passata();
      this.lastTickAt = this.deps.clock.nowIso();
      this.last = esito;
      return esito;
    } catch (cause) {
      this.errore(cause instanceof Error ? cause.message : String(cause));
      this.logger.error('passata non riuscita', { message: this.lastError });
      return NIENTE;
    } finally {
      this.ticking = false;
    }
  }

  /** Il budget di una passata: la quota al minuto divisa per le passate al minuto, con un tetto. */
  private callsPerTick(): number {
    if (this.deps.maxCallsPerTick !== undefined) {
      return Math.max(1, this.deps.maxCallsPerTick);
    }
    const quota = Math.floor((SPOKI_REPLY_POLL_CALLS_PER_MINUTE * this.deps.intervalSeconds) / 60);
    return Math.max(1, Math.min(SPOKI_REPLY_POLL_MAX_PER_TICK, quota));
  }

  private errore(messaggio: string): void {
    this.lastError = messaggio;
    this.lastErrorAt = this.deps.clock.nowIso();
  }

  private async passata(): Promise<ReplyPollSummary> {
    const oggi = this.deps.clock.today();
    if (this.giornata !== oggi) {
      // Giornata nuova: il promemoria di oggi rimette ATTESA, i conti di ieri non valgono più.
      this.giornata = oggi;
      this.cursor = 0;
      this.daAzzerare.clear();
    }
    const perNumero = await this.daGuardare(oggi);
    const numeri = [...perNumero.keys()];
    const budget = this.callsPerTick();
    const conteggio = { read: 0, blocked: 0, applied: 0, failed: 0 };
    let chiamate = 0;
    let fermati = false;
    const inizio = numeri.length === 0 ? 0 : this.cursor % numeri.length;
    let visitati = 0;
    while (visitati < numeri.length && chiamate < budget && !fermati) {
      const phone = numeri[(inizio + visitati) % numeri.length];
      visitati += 1;
      const pratiche = phone === undefined ? undefined : perNumero.get(phone);
      if (phone === undefined || pratiche === undefined) {
        continue;
      }
      const { esito, chiamate: costo } = await this.leggi(phone, pratiche);
      chiamate += costo;
      if (esito === 'BLOCKED') {
        conteggio.blocked += 1;
      } else if (esito === 'FAILED' || esito === 'RATE_LIMITED') {
        conteggio.failed += 1;
        fermati = esito === 'RATE_LIMITED';
      } else {
        conteggio.read += 1;
        if (esito === 'APPLIED') {
          conteggio.applied += 1;
        }
      }
    }
    this.cursor = numeri.length === 0 ? 0 : inizio + visitati;
    // Azzeramenti rimasti in sospeso di pratiche non più da guardare (arrivate, assenti).
    for (const phone of [...this.daAzzerare.keys()]) {
      if (fermati || chiamate >= budget) {
        break;
      }
      if (perNumero.has(phone)) {
        continue;
      }
      chiamate += 1;
      await this.azzera(phone, this.deps.ids.next());
    }
    return { watched: numeri.length, ...conteggio };
  }

  /**
   * Le pratiche di oggi da guardare, raggruppate per numero (due auto della stessa famiglia sono
   * lo stesso contatto Spoki), dalla più vicina come orario.
   */
  private async daGuardare(oggi: IsoDate): Promise<Map<PhoneE164, Appointment[]>> {
    const [giornata, jobs] = await Promise.all([
      this.deps.appointments.listByDate(oggi),
      this.deps.notifications.listByDate(oggi),
    ]);
    const conPromemoria = new Set(
      jobs.filter(promemoriaDelMattinoArrivato).map((j) => j.appointmentId),
    );
    const scelte = giornata
      .filter(
        (a) =>
          a.customer.phone !== null &&
          conPromemoria.has(a.id) &&
          isInQueue(a.status) &&
          a.customerArrivedAt === null,
      )
      .sort((x, y) => effectiveScheduleTime(x).localeCompare(effectiveScheduleTime(y)));
    const perNumero = new Map<PhoneE164, Appointment[]>();
    for (const a of scelte) {
      if (a.customer.phone !== null) {
        perNumero.set(a.customer.phone, [...(perNumero.get(a.customer.phone) ?? []), a]);
      }
    }
    return perNumero;
  }

  /** Legge ACC_PULSANTE di un contatto e, se c'è un tocco, lo applica e rimette il campo ad ATTESA. */
  private async leggi(phone: PhoneE164, pratiche: readonly Appointment[]): Promise<Lettura> {
    const correlationId = this.deps.ids.next();
    const valore = await this.valoreDi(phone, correlationId);
    if (valore.esito !== 'READ') {
      return { esito: valore.esito, chiamate: valore.esito === 'BLOCKED' ? 0 : 1 };
    }
    const payload = payloadDi(valore.valore);
    if (payload === undefined) {
      // ATTESA, vuoto o altro: niente da applicare.
      this.daAzzerare.delete(phone);
      return { esito: 'READ', chiamate: 1 };
    }
    let chiamate = 1;
    const nuovo = this.daAzzerare.get(phone) !== valore.valore;
    if (nuovo) {
      // La prima pratica ancora da guardare, cioè in coda e non arrivata, dalla più vicina:
      // con più auto sullo stesso numero il tocco va a quella, non a una già arrivata.
      const pratica = pratiche[0];
      const esito = await this.deps.inbound.handle({
        phone,
        text: payload,
        code: pratica?.code ?? null,
        correlationId,
        channel: 'POLLING',
        viaButton: true,
      });
      chiamate += 1;
      if (!esito.ok && esito.error.code !== 'VALIDATION' && esito.error.code !== 'NOT_FOUND') {
        // Conflitto o guasto sulla pratica: il campo resta com'è e la passata dopo riprova.
        this.errore(`${esito.error.code}: ${esito.error.message}`);
        this.logger.warn(`tocco «${valore.valore}» di ${maskPhone(phone)} non applicato`, {
          code: esito.error.code,
          message: esito.error.message,
          correlationId,
        });
        return { esito: 'FAILED', chiamate };
      }
      if (esito.ok) {
        this.appliedTotal += 1;
        this.lastAppliedAt = this.deps.clock.nowIso();
        this.logger.info(
          `pratica ${esito.value.appointment.code}: tocco «${valore.valore}» da Spoki`,
          {
            appointmentId: esito.value.appointment.id,
            risposta: esito.value.replyKind,
            rispostaPartita: esito.value.replySent,
            ripetuto: esito.value.repeated,
            correlationId,
          },
        );
      }
      this.daAzzerare.set(phone, valore.valore);
      // Il cliente può aver toccato un altro pulsante mentre si applicava questo: si rilegge, e
      // se il campo è cambiato non lo si tocca (il tocco nuovo lo prende la passata dopo).
      const riletto = await this.valoreDi(phone, correlationId);
      chiamate += 1;
      if (riletto.esito === 'READ' && riletto.valore !== valore.valore) {
        this.daAzzerare.delete(phone);
        return { esito: 'APPLIED', chiamate };
      }
    }
    await this.azzera(phone, correlationId);
    chiamate += 1;
    // Un tocco già applicato di cui si riprovava soltanto l'azzeramento non conta due volte.
    return { esito: nuovo ? 'APPLIED' : 'READ', chiamate };
  }

  /** Il valore di ACC_PULSANTE, maiuscolo e senza spazi; l'esito dice se la lettura c'è stata. */
  private async valoreDi(
    phone: PhoneE164,
    correlationId: string,
  ): Promise<
    | { readonly esito: 'READ'; readonly valore: string }
    | { readonly esito: 'BLOCKED' | 'FAILED' | 'RATE_LIMITED' }
  > {
    const letto = await this.deps.spoki.readContactFields({
      to: phone,
      codes: [SPOKI_BUTTON_FIELD],
      correlationId,
    });
    if (!letto.ok) {
      this.errore(`${letto.error.code}: ${letto.error.message}`);
      return { esito: letto.error.code === 'RATE_LIMIT' ? 'RATE_LIMITED' : 'FAILED' };
    }
    if (!letto.value.read) {
      return { esito: 'BLOCKED' };
    }
    return {
      esito: 'READ',
      valore: (letto.value.fields[SPOKI_BUTTON_FIELD] ?? '').trim().toUpperCase(),
    };
  }

  /** Rimette ACC_PULSANTE ad ATTESA; se non riesce, resta in sospeso per le passate dopo. */
  private async azzera(phone: PhoneE164, correlationId: string): Promise<void> {
    const azzerato = await this.deps.spoki.updateContactFields({
      to: phone,
      fields: { [SPOKI_BUTTON_FIELD]: 'ATTESA' },
      correlationId,
    });
    if (azzerato.ok && azzerato.value.updated) {
      this.daAzzerare.delete(phone);
      return;
    }
    this.logger.warn(`${maskPhone(phone)}: ACC_PULSANTE non rimesso ad ATTESA, si riprova`, {
      errore: azzerato.ok ? 'scrittura bloccata' : azzerato.error.message,
      correlationId,
    });
  }
}

/** Il payload del pulsante per un valore di ACC_PULSANTE; undefined se non è un tocco. */
function payloadDi(valore: string): string | undefined {
  return Object.hasOwn(SPOKI_BUTTON_PAYLOADS, valore)
    ? SPOKI_BUTTON_PAYLOADS[valore as keyof typeof SPOKI_BUTTON_PAYLOADS]
    : undefined;
}
