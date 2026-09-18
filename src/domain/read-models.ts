// Read model: le uniche forme restituite dalle API pubbliche (/api/v1/public/*).
// Nessun nome, telefono o modello: solo codice, stato e posizione.

import type { Appointment, AppointmentStatus } from './entities/appointment';
import type { CrmEventType, CrmOutboxStatus } from './entities/crm-outbox-event';
import type { NotificationChannel, NotificationJobStatus } from './entities/notification';
import type { BayId } from './ids';
import type { IsoDate, IsoDateTime } from './value-objects/iso-date';
import type { PlateNumber } from './value-objects/plate';
import type { QueueCode } from './value-objects/queue-code';

/** Posizione in coda mostrata dal portale cliente dopo la ricerca per targa. */
export interface QueuePositionView {
  readonly code: QueueCode;
  readonly status: AppointmentStatus;
  /** Clienti in attesa prima del cliente (regola QUEUE_AHEAD_SCOPE). */
  readonly aheadCount: number;
  /**
   * Lettera dello sportello fisico dove presentarsi (A, B, C, D) quando la pratica è IN_PROGRESS.
   * È la stessa che il cliente legge sul tabellone e sopra la postazione: il numero interno non
   * esce mai dal sistema.
   */
  readonly bayCode: string | null;
  readonly brandCode: string;
  /** Orario di prenotazione: aiuta il cliente a riconoscere il proprio appuntamento. */
  readonly scheduledAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

/** Stato del monitor di uno sportello. OFFLINE è deciso dal client dopo 3 poll falliti. */
export type BayDisplayState = 'SERVING' | 'RELEASING' | 'FREE' | 'OFFLINE';

/**
 * Read model del monitor appeso sopra uno sportello fisico, calcolato dalle pratiche (nessuno
 * stato persistito sulla Bay). `bayCode` è la lettera (A, B, C, D) che il cliente legge a video.
 */
export interface BayDisplayView {
  readonly bayCode: string;
  readonly bayNumber: number;
  readonly bayName: string;
  readonly state: BayDisplayState;
  readonly currentCode: QueueCode | null;
  /**
   * Targa in lavorazione: il monitor è appeso sopra lo sportello e serve a far riconoscere al
   * cliente la propria vettura. È l'unico dato del veicolo esposto, senza nome né telefono.
   */
  readonly currentPlate: string | null;
  readonly since: IsoDateTime | null;
  readonly lastCompletedCode: QueueCode | null;
  readonly lastCompletedAt: IsoDateTime | null;
}

/**
 * Sportello come lo vede la dashboard: identificativo, lettera, nome e stato. Niente
 * `displayToken`: quel segreto serve solo ai monitor kiosk per autenticarsi, e una risposta letta
 * da ogni sessione operatore non è il posto dove farlo circolare.
 */
export interface BayOptionView {
  readonly id: BayId;
  readonly code: string;
  readonly number: number;
  readonly name: string;
  readonly isActive: boolean;
}

/** Occupazione di uno sportello come esce dall'API della coda. */
export interface BayOccupancyOptionView {
  readonly bay: BayOptionView;
  /** Pratica che lo occupa adesso; null se è libero. */
  readonly appointment: Appointment | null;
  /**
   * Area di marchio a cui lo sportello appartiene (A e B su FCA, C e D su PSA). Non sta sullo
   * sportello — si deduce dalla postazione che ce l'ha come predefinito — ma serve a chi sceglie
   * quale coda guardare, perché la coda è dell'area, non del singolo sportello.
   */
  readonly deskId: string | null;
  /** Chi è seduto adesso, dalla rivendicazione della postazione; null se lo sportello è libero. */
  readonly operatorName: string | null;
}

/** Riga del tabellone della sala d'attesa: codice chiamato e dove presentarsi. */
export interface BoardServingEntry {
  readonly code: QueueCode;
  /**
   * Lettera dello sportello assegnato (A, B, C, D), cioè dove il cliente deve andare; null se la
   * presa in carico non l'ha indicato.
   */
  readonly bayCode: string | null;
  /** Ordinale interno dello sportello: serve all'ordinamento, non si mostra al cliente. */
  readonly bayNumber: number | null;
  /** Area per marchio (FCA/PSA), usata come indicazione di ripiego quando lo sportello manca. */
  readonly deskCode: string | null;
  readonly since: IsoDateTime | null;
}

/** Codice in attesa mostrato fra i prossimi turni. */
export interface BoardNextEntry {
  readonly code: QueueCode;
  readonly scheduledAt: IsoDateTime;
}

/**
 * Tabellone della sala d'attesa: chi è chiamato ora e chi sono i prossimi.
 * Come i tabelloni degli uffici pubblici, mostra SOLO codici: nessuna targa e nessun nome,
 * perché lo schermo è visibile a tutte le persone presenti in sala.
 */
export interface WaitingBoardView {
  readonly serving: readonly BoardServingEntry[];
  readonly next: readonly BoardNextEntry[];
  /** Quante pratiche sono ancora in coda oggi (attesa e saltate). */
  readonly waitingCount: number;
}

/** Riga della tabella coda per la dashboard operatore (area autenticata). */
export interface QueueRowView {
  readonly appointment: Appointment;
  readonly operatorName: string | null;
  readonly bayCode: string | null;
  /** Esito del contatto con il cliente; null se nessuna notifica è stata creata. */
  readonly notificationStatus: NotificationJobStatus | null;
  /** Canale dell'ultimo tentativo: distingue il WhatsApp riuscito dall'SMS di ripiego. */
  readonly notificationChannel: NotificationChannel | null;
}

/**
 * Riga del cruscotto BDC (modulo F): un cliente da ricontattare, con quanto serve per telefonargli
 * senza aprire altre schermate. Nasce dall'evento in coda di uscita verso il CRM e viene arricchita
 * con i dati della pratica; se la pratica non è più in memoria restano codice, motivo e giornata,
 * perché un lead a metà è comunque meglio di un lead perso.
 */
export interface BdcLeadView {
  readonly eventId: string;
  readonly type: CrmEventType;
  /** Stato dell'evento verso il CRM: MANUAL = già gestito dal BDC. */
  readonly deliveryStatus: CrmOutboxStatus;
  readonly appointmentId: string;
  readonly code: QueueCode | null;
  readonly businessDate: string | null;
  readonly scheduledAt: IsoDateTime | null;
  readonly customerName: string | null;
  readonly phone: string | null;
  readonly plate: string | null;
  readonly vehicle: string | null;
  readonly deskCode: string | null;
  /** Motivo scritto dall'accettatore quando ha segnato l'assenza. */
  readonly reason: string | null;
  /** Quando l'assenza è stata registrata in officina. */
  readonly detectedAt: IsoDateTime;
  readonly handled: boolean;
  readonly handledAt: IsoDateTime | null;
  readonly handledByName: string | null;
  readonly handledNote: string | null;
}

/** Cruscotto BDC completo: lead aperti, lead già chiusi e conteggi per l'intestazione. */
export interface BdcLeadsView {
  readonly leads: readonly BdcLeadView[];
  readonly openCount: number;
  readonly handledCount: number;
}

/**
 * Riga della coda di uscita verso il CRM come la vede il tecnico: stato tecnico della consegna,
 * non il lavoro del BDC. Serve a rispondere a "il CRM sta ricevendo?" senza aprire i log.
 */
export interface CrmOutboxRowView {
  readonly eventId: string;
  readonly type: CrmEventType;
  readonly status: CrmOutboxStatus;
  readonly appointmentId: string;
  /** Codice della pratica (dal payload salvato: resta leggibile anche a pratica archiviata). */
  readonly code: string | null;
  readonly createdAt: IsoDateTime;
  readonly sentAt: IsoDateTime | null;
  readonly nextAttemptAt: IsoDateTime | null;
  readonly attemptCount: number;
  readonly lastError: string | null;
  readonly crmAckId: string | null;
  readonly idempotencyKey: string;
}

/** Coda di uscita con i conteggi per stato, per l'intestazione del pannello Sistema. */
export interface CrmOutboxView {
  readonly rows: readonly CrmOutboxRowView[];
  readonly counts: {
    readonly pending: number;
    readonly sent: number;
    readonly failed: number;
    readonly manual: number;
  };
}

/**
 * Tappa del percorso mostrata dal portale cliente: 1 In attesa (in coda), 2 In accettazione
 * (presa in carico), 3 In lavorazione (check-in concluso, vettura in officina), 4 Pronta per il
 * ritiro (arriverà dallo stato "Veicolo pronto alla consegna" del gestionale).
 */
export type PortalStage = 1 | 2 | 3 | 4;

/**
 * Stato della pratica come lo legge il cliente dal telefono (link WhatsApp o QR): posizione in
 * coda più le informazioni dell'appuntamento. Nessun dato personale del cliente; il nome
 * dell'accettatore è quello del personale che lo riceverà.
 */
export interface PortalStatusView extends QueuePositionView {
  readonly businessDate: IsoDate;
  readonly plate: PlateNumber;
  readonly stage: PortalStage;
  /** Orario a cui il cliente è atteso adesso (riprogrammato in officina, se c'è). */
  readonly expectedTime: IsoDateTime;
  readonly siteName: string;
  /** Area per marchio che serve la pratica (es. "Sportelli A e B"). */
  readonly deskName: string | null;
  /** Accettatore che ha preso in carico la pratica; null finché è in attesa. */
  readonly operatorName: string | null;
  /** Ultima auto-segnalazione di ritardo fatta dal cliente, se c'è. */
  readonly lateNotice: {
    readonly at: IsoDateTime;
    readonly etaAt: IsoDateTime;
    readonly minutes: number;
  } | null;
  /**
   * Posizione in fila: 1 = è il prossimo. Vale mentre la pratica è in coda, altrimenti è null
   * (chiamato, in accettazione o concluso non si sta più "in fila").
   */
  readonly queuePosition: number | null;
  /** Quando il cliente ha dichiarato di essere arrivato (risposta «Arrivato» o portale). */
  readonly arrivedAt: IsoDateTime | null;
  /** Quando l'accettatore lo ha chiamato allo sportello; null finché è in attesa. */
  readonly startedAt: IsoDateTime | null;
  /** True se il pulsante "Sto arrivando in ritardo" ha senso adesso. */
  readonly canReportDelay: boolean;
  /** Pratica conclusa da oltre la soglia (24 h) o di una giornata passata: si mostra solo la chiusura. */
  readonly expired: boolean;
  readonly concludedAt: IsoDateTime | null;
}
