// Risposte del cliente su WhatsApp (modulo C, lato in entrata).
//
// Il messaggio del mattino porta tre pulsanti rapidi — «Sono arrivato», «In ritardo», «Non posso
// venire» — e Spoki ce li rimanda su un webhook con il loro payload (ACTION_ARRIVED, ACTION_LATE,
// ACTION_ABSENT); chi risponde scrivendo (SMS di ripiego) usa le parole o il numero dell'opzione.
// Qui quei tre gesti diventano tre fatti dell'officina, ognuno con la sua risposta automatica:
//
// - ARRIVATO   → la pratica resta in coda al suo posto, ma si annota l'ora dell'arrivo («in fila
//                dalle …» in dashboard) e il cliente riceve subito codice e smart link personale
//                al tracciamento (niente più QR da inquadrare). GUARDRAIL: se manca più di
//                SPOKI_MAX_EARLY_ARRIVAL_MINUTES all'orario (il pulsante premuto appena letto il
//                promemoria del mattino, con l'appuntamento alle 16:00) la pratica non si tocca e
//                il cliente riceve un messaggio che spiega quando ripremere;
// - IN RITARDO → la stessa segnalazione del portale: l'arrivo atteso si sposta e la dashboard
//                mostra l'avviso ambra, senza toccare l'ordine della coda; il cliente riceve la
//                conferma che l'accettazione è stata avvisata;
// - ASSENTE    → il cliente dice che non viene: la pratica diventa NO_SHOW (lo slot in coda si
//                libera) e il BDC la trova nel proprio elenco per richiamarlo e riprogrammare
//                l'appuntamento su Infinity; il cliente riceve la conferma dell'annullamento.
//
// CHI RISPONDE. Con le automazioni Spoki dei pulsanti attive (SPOKI_REPLIES_BY_AUTOMATION=true) la
// conferma al cliente la manda Spoki, anche quando questo server non risponde: l'app registra il
// fatto e restituisce all'automazione il testo che spetta al cliente (`replyText`, con codice e link
// personale, o il messaggio «troppo presto»), che Spoki consegna; se il server è giù, l'automazione
// manda il suo testo di riserva. Una chiamata che arriva dall'automazione (`channel: AUTOMATION`)
// non fa mai partire una risposta dall'app, qualunque sia l'interruttore.
//
// Tutto passa dai casi d'uso esistenti (portale e coda): questo servizio traduce, non decide.
// Un messaggio che non corrisponde a nessuna delle tre risposte viene ignorato senza errori: sul
// numero dell'officina arriva di tutto, e un «grazie» non deve segnare nessuno come assente.
import { DEFAULT_MAX_EARLY_ARRIVAL_MINUTES } from '@/config/constants';
import type { Appointment } from '@/domain/entities/appointment';
import { effectiveScheduleTime, isInQueue } from '@/domain/entities/appointment';
import type { Brand } from '@/domain/entities/brand';
import type { NotificationKind } from '@/domain/entities/notification';
import { domainError, type DomainError } from '@/domain/errors';
import { err, ok, type Result } from '@/domain/result';
import { parsePhoneE164, type PhoneE164 } from '@/domain/value-objects/phone';
import type { IAppointmentRepository, IReferenceDataRepository } from '@/repositories/interfaces';
import type { IClock } from '@/services/interfaces/IClock';
import type { IEventBus } from '@/services/interfaces/IEventBus';
import type { IIdGenerator } from '@/services/interfaces/IIdGenerator';
import type { ILogger } from '@/services/interfaces/ILogger';
import type { CustomerPortalService } from '../portal/CustomerPortalService';
import { SYSTEM_ACTOR_ID, type ActionContext, type QueueService } from '../queue/QueueService';
import type { NotificationOrchestrator } from './NotificationOrchestrator';

/** Le tre risposte previste dal messaggio WhatsApp. */
export type CustomerReply = 'ARRIVED' | 'LATE' | 'ABSENT';

/** I messaggi con cui si risponde al cliente. */
export type ReplyKind = Extract<
  NotificationKind,
  'ARRIVAL_CONFIRMED' | 'LATE_CONFIRMED' | 'ABSENT_CONFIRMED' | 'ARRIVAL_TOO_EARLY'
>;

/** Da dove arriva la risposta del cliente. */
export type InboundChannel =
  /** Webhook V2 di Spoki (`message.inbound`). */
  | 'EVENT'
  /** Passo «webhook» di un'automazione Spoki: al cliente risponde l'automazione. */
  | 'AUTOMATION'
  /** Forma piatta per prove manuali. */
  | 'MANUAL';

/** Motivo registrato sulla pratica quando è il cliente a dichiararsi assente. */
export const CUSTOMER_ABSENT_REASON = 'Il cliente ha risposto «Assente» al messaggio WhatsApp';

/** Payload tecnici dei tre pulsanti rapidi del template Spoki, come tornano nel webhook. */
export const QUICK_REPLY_BY_PAYLOAD: Readonly<Record<string, CustomerReply>> = {
  ACTION_ARRIVED: 'ARRIVED',
  ACTION_LATE: 'LATE',
  ACTION_ABSENT: 'ABSENT',
};

/**
 * Riconosce la risposta del cliente. Spoki manda il payload del pulsante (ACTION_ARRIVED,
 * ACTION_LATE, ACTION_ABSENT) o la sua etichetta; chi scrive a mano (sull'SMS di ripiego) usa le
 * parole o il numero dell'opzione: si accettano tutte le forme, senza accenti e senza distinzione
 * fra maiuscole e minuscole.
 */
export function parseCustomerReply(raw: string | null | undefined): CustomerReply | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const payload = QUICK_REPLY_BY_PAYLOAD[raw.trim().toUpperCase()];
  if (payload !== undefined) {
    return payload;
  }
  const testo = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (testo === '') {
    return null;
  }
  if (
    /\b(arrivat[oa]|sono qui|sono arrivat[oa]|presente|arrived|action arrived)\b/.test(testo) ||
    testo === '1'
  ) {
    return 'ARRIVED';
  }
  if (/\b(in ritardo|ritardo|tardi|late|action late)\b/.test(testo) || testo === '2') {
    return 'LATE';
  }
  if (
    /\b(assente|non vengo|non posso|annull\w*|disdi\w*|no show|action absent)\b/.test(testo) ||
    testo === '3'
  ) {
    return 'ABSENT';
  }
  return null;
}

export interface WhatsAppInboundServiceDeps {
  readonly appointments: IAppointmentRepository;
  readonly referenceData: IReferenceDataRepository;
  readonly portal: CustomerPortalService;
  readonly queueService: QueueService;
  readonly orchestrator: NotificationOrchestrator;
  readonly eventBus: IEventBus;
  readonly clock: IClock;
  readonly ids: IIdGenerator;
  readonly logger: ILogger;
  /** Finestra di anticipo massimo per «Sono arrivato» (SPOKI_MAX_EARLY_ARRIVAL_MINUTES); predefinito 60. */
  readonly maxEarlyArrivalMinutes?: number;
  /**
   * SPOKI_REPLIES_BY_AUTOMATION: true = ai pulsanti risponde l'automazione Spoki, l'app non manda la
   * conferma nemmeno quando la tocca arriva dal webhook V2. Predefinito false.
   */
  readonly repliesByAutomation?: boolean;
}

/** Com'è andata la risposta del cliente, per la risposta al webhook e per i log. */
export interface InboundResult {
  readonly reply: CustomerReply;
  readonly appointment: Appointment;
  /** True quando la risposta non ha cambiato nulla perché era già stata registrata. */
  readonly repeated: boolean;
  /** True se al cliente è partita (o è stata messa in coda) la risposta automatica. */
  readonly replySent: boolean;
  /**
   * «Sono arrivato» premuto troppo presto: la pratica non è stata toccata e il cliente ha ricevuto
   * il messaggio che spiega quando ripremere. Falso per tutte le altre risposte.
   */
  readonly premature: boolean;
  /** Chi risponde al cliente: l'app (orchestratore) o l'automazione Spoki. */
  readonly replyBy: 'APP' | 'SPOKI';
  /** Il messaggio che spetta al cliente, anche quando lo consegna Spoki; null se non ce n'è. */
  readonly replyKind: ReplyKind | null;
  /** Il testo di quel messaggio (codice, orario, link personale); null se non ce n'è. */
  readonly replyText: string | null;
}

/** Messaggio in entrata, già estratto dal corpo del webhook. */
export interface InboundMessage {
  readonly phone: string;
  readonly text: string;
  /** Codice della pratica, se il provider lo rimanda: toglie ogni ambiguità sul numero. */
  readonly code?: string | null;
  readonly correlationId?: string | null;
  /** Da dove arriva; predefinito `EVENT`. */
  readonly channel?: InboundChannel;
  /** True quando il cliente ha toccato un pulsante (payload del pulsante rapido), non scritto a mano. */
  readonly viaButton?: boolean;
}

/** Com'è andata la risposta automatica: partita dall'app, oppure solo preparata per Spoki. */
interface ReplyOutcome {
  readonly sent: boolean;
  readonly kind: ReplyKind | null;
  readonly text: string | null;
}

const NESSUNA_RISPOSTA: ReplyOutcome = { sent: false, kind: null, text: null };

export class WhatsAppInboundService {
  private readonly logger: ILogger;

  constructor(private readonly deps: WhatsAppInboundServiceDeps) {
    this.logger = deps.logger.child('[WhatsAppIn]');
  }

  /** Applica la risposta del cliente alla sua pratica di oggi. */
  async handle(message: InboundMessage): Promise<Result<InboundResult, DomainError>> {
    const reply = parseCustomerReply(message.text);
    if (reply === null) {
      return err(
        domainError('VALIDATION', 'Risposta non riconosciuta.', {
          testo: message.text.slice(0, 80),
        }),
      );
    }
    const phone = parsePhoneE164(message.phone);
    if (!phone.ok) {
      return phone;
    }
    const appointment = await this.findToday(phone.value, message.code ?? null);
    if (appointment === null) {
      this.logger.warn('risposta senza pratica in agenda oggi', { reply });
      return err(domainError('NOT_FOUND', 'Nessuna pratica in agenda oggi per questo numero.'));
    }

    // Ai pulsanti risponde Spoki se la chiamata viene dall'automazione, oppure se le automazioni dei
    // pulsanti sono attive e il cliente ha toccato un pulsante (non scritto a mano: quello resta
    // all'app, perché nessuna automazione lo intercetta).
    const replyBy: 'APP' | 'SPOKI' =
      message.channel === 'AUTOMATION' ||
      (this.deps.repliesByAutomation === true && message.viaButton === true)
        ? 'SPOKI'
        : 'APP';
    const correlationId = message.correlationId ?? null;
    switch (reply) {
      case 'ARRIVED':
        return this.registerArrival(appointment, correlationId, replyBy);
      case 'LATE':
        return this.registerLate(appointment, correlationId, replyBy);
      case 'ABSENT':
        return this.registerAbsent(appointment, correlationId, replyBy);
    }
  }

  /**
   * «Arrivato»: la registrazione è la stessa del pulsante sulla pagina di tracciamento (una sola
   * regola, due porte d'ingresso); qui si aggiunge la risposta con codice e link, che dal portale
   * non serve perché il cliente quella pagina ce l'ha già davanti.
   */
  private async registerArrival(
    a: Appointment,
    correlationId: string | null,
    replyBy: 'APP' | 'SPOKI',
  ): Promise<Result<InboundResult, DomainError>> {
    // GUARDRAIL: troppo presto rispetto all'orario? Niente fila, niente codice: solo il messaggio
    // che dice quando ripremere. «In ritardo» e «Non posso venire» non passano di qui.
    const anticipoMs =
      new Date(effectiveScheduleTime(a)).getTime() - this.deps.clock.now().getTime();
    if (isInQueue(a.status) && a.customerArrivedAt === null && anticipoMs > this.maxEarlyMs()) {
      this.logger.info(
        `pratica ${a.code}: «Sono arrivato» con ${Math.round(anticipoMs / 60_000)} minuti di anticipo, oltre la finestra`,
        {
          appointmentId: a.id,
          finestraMinuti: this.maxEarlyMinutes(),
        },
      );
      const r = await this.reply(a, 'ARRIVAL_TOO_EARLY', correlationId, replyBy, {
        dedupeSuffix: this.deps.clock.nowIso().slice(0, 16),
      });
      return ok(result('ARRIVED', a, { repeated: false, premature: true }, replyBy, r));
    }
    const esito = await this.deps.portal.registerArrival({ plate: a.vehicle.plate }, 'WHATSAPP');
    if (!esito.ok) {
      return esito;
    }
    const corrente = esito.value.appointment;
    if (!esito.value.registered) {
      // Arrivo già registrato, o pratica non più in coda: niente da fare, e l'app non riscrive.
      // All'automazione Spoki (che risponde a ogni tocco) si ridà codice e link se il cliente è in
      // fila: la stessa tocca può arrivare prima dal webhook V2 e poi dall'automazione.
      const r =
        replyBy === 'SPOKI' && isInQueue(corrente.status) && corrente.customerArrivedAt !== null
          ? await this.reply(corrente, 'ARRIVAL_CONFIRMED', correlationId, replyBy)
          : NESSUNA_RISPOSTA;
      return ok(result('ARRIVED', corrente, { repeated: true, premature: false }, replyBy, r));
    }
    const r = await this.reply(corrente, 'ARRIVAL_CONFIRMED', correlationId, replyBy);
    return ok(result('ARRIVED', corrente, { repeated: false, premature: false }, replyBy, r));
  }

  private maxEarlyMinutes(): number {
    return this.deps.maxEarlyArrivalMinutes ?? DEFAULT_MAX_EARLY_ARRIVAL_MINUTES;
  }

  private maxEarlyMs(): number {
    return this.maxEarlyMinutes() * 60_000;
  }

  /**
   * «In ritardo»: la stessa segnalazione del portale, con i suoi limiti e il suo evento; al primo
   * tocco il cliente riceve la conferma che l'accettazione è stata avvisata.
   */
  private async registerLate(
    a: Appointment,
    correlationId: string | null,
    replyBy: 'APP' | 'SPOKI',
  ): Promise<Result<InboundResult, DomainError>> {
    const prima = a.customerLateNoticeAt;
    const esito = await this.deps.portal.reportDelay(
      { plate: a.vehicle.plate },
      undefined,
      'WHATSAPP',
    );
    if (!esito.ok) {
      return esito;
    }
    const corrente = (await this.deps.appointments.findById(a.id)) ?? a;
    const repeated = prima !== null && corrente.customerLateNoticeAt === prima;
    // L'app conferma solo il primo avviso; Spoki risponde a ogni tocco, quindi gli si ridà il testo.
    const r =
      repeated && replyBy === 'APP'
        ? NESSUNA_RISPOSTA
        : await this.reply(corrente, 'LATE_CONFIRMED', correlationId, replyBy);
    return ok(result('LATE', corrente, { repeated, premature: false }, replyBy, r));
  }

  /**
   * «Assente»: il cliente dice che non viene. La pratica diventa NO_SHOW con l'attore SYSTEM (non
   * l'ha deciso un accettatore) e il motivo scritto, così nel cruscotto BDC si distingue chi non
   * si è presentato da chi ha avvisato.
   */
  private async registerAbsent(
    a: Appointment,
    correlationId: string | null,
    replyBy: 'APP' | 'SPOKI',
  ): Promise<Result<InboundResult, DomainError>> {
    if (a.status === 'NO_SHOW') {
      const r =
        replyBy === 'SPOKI'
          ? await this.reply(a, 'ABSENT_CONFIRMED', correlationId, replyBy)
          : NESSUNA_RISPOSTA;
      return ok(result('ABSENT', a, { repeated: true, premature: false }, replyBy, r));
    }
    const ctx: ActionContext = {
      operatorId: SYSTEM_ACTOR_ID,
      workstationId: null,
      correlationId: correlationId ?? this.deps.ids.next(),
      actorKind: 'SYSTEM',
    };
    const esito = await this.deps.queueService.markNoShow(
      { appointmentId: a.id, expectedVersion: a.version, reason: CUSTOMER_ABSENT_REASON },
      ctx,
    );
    if (!esito.ok) {
      return esito;
    }
    this.logger.info(`cliente assente per sua segnalazione: ${a.code}`, { appointmentId: a.id });
    const r = await this.reply(esito.value, 'ABSENT_CONFIRMED', correlationId, replyBy);
    return ok(result('ABSENT', esito.value, { repeated: false, premature: false }, replyBy, r));
  }

  /**
   * Risposta automatica al cliente (codice e smart link, ritardo registrato, annullamento, «troppo
   * presto»): con `replyBy = SPOKI` si prepara solo il testo, che consegna l'automazione; altrimenti
   * parte dall'orchestratore. Un guasto qui non annulla il fatto già registrato sulla pratica.
   */
  private async reply(
    a: Appointment,
    kind: ReplyKind,
    correlationId: string | null,
    replyBy: 'APP' | 'SPOKI',
    options: { readonly dedupeSuffix?: string } = {},
  ): Promise<ReplyOutcome> {
    const brands: readonly Brand[] = await this.deps.referenceData.listBrands();
    const brand = brands.find((b) => b.id === a.brandId);
    if (brand === undefined) {
      this.logger.warn('marchio sconosciuto: nessuna risposta inviata', { code: a.code });
      return NESSUNA_RISPOSTA;
    }
    const text = this.deps.orchestrator.renderText(a, brand, kind);
    if (replyBy === 'SPOKI') {
      this.logger.info(`pratica ${a.code}: risposta ${kind} affidata all'automazione Spoki`, {
        appointmentId: a.id,
      });
      return { sent: false, kind, text };
    }
    return { sent: await this.sendReply(a, brand, kind, correlationId, options), kind, text };
  }

  private async sendReply(
    a: Appointment,
    brand: Brand,
    kind: ReplyKind,
    correlationId: string | null,
    options: { readonly dedupeSuffix?: string },
  ): Promise<boolean> {
    try {
      const run = await this.deps.orchestrator.sendReminder({
        appointment: a,
        brand,
        kind,
        correlationId: correlationId ?? this.deps.ids.next(),
        ...(options.dedupeSuffix === undefined ? {} : { dedupeSuffix: options.dedupeSuffix }),
      });
      // Consegnato su WhatsApp, ripiegato su SMS o già mandato: per il cliente è partita.
      return (
        run.outcome.kind === 'WHATSAPP_SENT' ||
        run.outcome.kind === 'SMS_FALLBACK_SENT' ||
        run.outcome.kind === 'ALREADY_PROCESSED'
      );
    } catch (cause) {
      this.logger.error('risposta automatica non inviata', {
        code: a.code,
        kind,
        errore: cause instanceof Error ? cause.message : String(cause),
      });
      return false;
    }
  }

  /**
   * La pratica di oggi per quel numero: se il provider rimanda il codice si usa quello, altrimenti
   * si cerca il telefono fra le pratiche della giornata. Con più pratiche per lo stesso numero
   * (due auto della stessa famiglia) vince quella ancora in coda, poi la più vicina come orario.
   */
  private async findToday(phone: PhoneE164, code: string | null): Promise<Appointment | null> {
    const oggi = this.deps.clock.today();
    if (code !== null && code.trim() !== '') {
      const perCodice = await this.deps.appointments.findByCode(
        code.trim().toUpperCase() as Appointment['code'],
        oggi,
      );
      if (perCodice !== null) {
        return perCodice;
      }
    }
    const giornata = await this.deps.appointments.listByDate(oggi);
    const sue = giornata.filter((a) => a.customer.phone === phone);
    if (sue.length === 0) {
      return null;
    }
    const inCoda = sue.filter((a) => isInQueue(a.status));
    return (inCoda.length > 0 ? inCoda : sue)[0] ?? null;
  }
}

/** Il risultato della risposta, con chi risponde e il testo che spetta al cliente. */
function result(
  reply: CustomerReply,
  appointment: Appointment,
  flags: { readonly repeated: boolean; readonly premature: boolean },
  replyBy: 'APP' | 'SPOKI',
  r: ReplyOutcome,
): InboundResult {
  return {
    reply,
    appointment,
    repeated: flags.repeated,
    replySent: r.sent,
    premature: flags.premature,
    replyBy,
    replyKind: r.kind,
    replyText: r.text,
  };
}

/**
 * L'esito in una parola, per l'automazione Spoki: lo salva in un campo del contatto (mappatura della
 * risposta del webhook) e sceglie il ramo. Se il server non risponde il campo resta `ATTESA` e
 * l'automazione manda il suo testo di riserva.
 */
export type AutomationOutcome =
  | 'ARRIVATO'
  | 'TROPPO_PRESTO'
  | 'GIA_REGISTRATO'
  | 'RITARDO'
  | 'ASSENTE'
  | 'NESSUNA_PRATICA'
  | 'NON_RICONOSCIUTO';

export function automationOutcomeOf(r: InboundResult): AutomationOutcome {
  switch (r.reply) {
    case 'ARRIVED':
      return r.premature ? 'TROPPO_PRESTO' : r.repeated ? 'GIA_REGISTRATO' : 'ARRIVATO';
    case 'LATE':
      return 'RITARDO';
    case 'ABSENT':
      return 'ASSENTE';
  }
}
