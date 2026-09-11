// Read model: le uniche forme restituite dalle API pubbliche (/api/v1/public/*).
// Nessun nome, telefono o modello: solo codice, stato e posizione.

import type { Appointment, AppointmentStatus } from './entities/appointment';
import type { CrmEventType, CrmOutboxStatus } from './entities/crm-outbox-event';
import type { NotificationChannel, NotificationJobStatus } from './entities/notification';
import type { IsoDateTime } from './value-objects/iso-date';
import type { QueueCode } from './value-objects/queue-code';

/** Posizione in coda mostrata dal portale cliente dopo la ricerca per targa. */
export interface QueuePositionView {
  readonly code: QueueCode;
  readonly status: AppointmentStatus;
  /** Clienti in attesa prima del cliente (regola QUEUE_AHEAD_SCOPE). */
  readonly aheadCount: number;
  /** Campata in servizio quando la pratica è IN_PROGRESS. */
  readonly bayNumber: number | null;
  readonly brandCode: string;
  /** Orario di prenotazione: aiuta il cliente a riconoscere il proprio appuntamento. */
  readonly scheduledAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

/** Stato del display di campata. OFFLINE è deciso dal client dopo 3 poll falliti. */
export type BayDisplayState = 'SERVING' | 'RELEASING' | 'FREE' | 'OFFLINE';

/** Read model del display di campata, calcolato dalle pratiche (nessuno stato persistito sulla Bay). */
export interface BayDisplayView {
  readonly bayCode: string;
  readonly bayNumber: number;
  readonly bayName: string;
  readonly state: BayDisplayState;
  readonly currentCode: QueueCode | null;
  /**
   * Targa in lavorazione: il monitor è appeso sopra la campata e serve a far riconoscere al
   * cliente la propria vettura. È l'unico dato del veicolo esposto, senza nome né telefono.
   */
  readonly currentPlate: string | null;
  readonly since: IsoDateTime | null;
  readonly lastCompletedCode: QueueCode | null;
  readonly lastCompletedAt: IsoDateTime | null;
}

/** Riga del tabellone della sala d'attesa: codice chiamato e dove presentarsi. */
export interface BoardServingEntry {
  readonly code: QueueCode;
  /** Campata assegnata (dove il cliente deve andare); null se la presa in carico non l'ha indicata. */
  readonly bayCode: string | null;
  readonly bayNumber: number | null;
  /** Sportello, usato come indicazione di ripiego quando la campata manca. */
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
