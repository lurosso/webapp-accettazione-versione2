// Messaggi di cortesia mostrati al cliente per ogni stato della pratica (modulo B). Testi separati
// dai componenti: sono la parte che il committente rivedrà più spesso.
//
// ESSENZIALI (M8-T56, 2026-09-28): chi legge è spesso una persona anziana, in auto, con il telefono
// in mano. Un titolo di due o tre parole e UNA frase breve che dice cosa fare; niente termini
// d'ufficio, niente spiegazioni del funzionamento della coda.
import type { AppointmentStatus } from '@/domain/entities/appointment';

/** Tono grafico della schermata, coerente con i token colore degli stati. */
export type StatusTone = 'waiting' | 'serving' | 'done' | 'attention';

export interface StatusMessage {
  /** Titolo grande, la prima cosa che il cliente legge. */
  readonly headline: string;
  /** Una frase sotto il titolo: cosa fare adesso. */
  readonly detail: string;
  readonly tone: StatusTone;
  /** Il conteggio "auto prima di lei" ha senso solo mentre si è in coda. */
  readonly showAheadCount: boolean;
}

/**
 * Messaggio per lo stato, con la lettera dello sportello quando la vettura è in accettazione.
 *
 * Il cliente non è seduto in una sala: è **in auto, in fila** davanti all'officina, con il motore
 * acceso e il telefono in mano. I testi lo danno per scontato — si aspetta in auto, si avanza
 * verso lo sportello — perché un messaggio che descrive una scena diversa da quella che il cliente
 * ha davanti lo fa dubitare di aver capito.
 *
 * Si dà del LEI. È la voce dell'azienda verso un cliente che non conosce, e su una schermata che
 * parla al posto dell'accettatore il tu suona come una confidenza che nessuno ha concesso.
 *
 * Nessuna frase ha un participio o un aggettivo riferito al cliente («non l'abbiamo vista»,
 * «è il primo»): con il lei di cortesia la concordanza è terreno minato — la norma la vuole
 * femminile anche a un uomo, l'uso corrente segue il genere reale, e in mezzo c'è un cliente che
 * si sente chiamare al femminile senza esserlo. Le frasi qui sono costruite per non doverlo
 * decidere: si parla del turno, dell'arrivo, del veicolo.
 */
export function statusMessage(status: AppointmentStatus, bayCode: string | null): StatusMessage {
  switch (status) {
    case 'WAITING':
      return {
        headline: 'È in fila',
        detail: 'Resti pure in auto: la chiamiamo noi.',
        tone: 'waiting',
        showAheadCount: true,
      };
    case 'SKIPPED':
      return {
        headline: 'È in fila',
        detail: 'Il suo turno è stato spostato di poco: la chiamiamo a breve.',
        tone: 'waiting',
        showAheadCount: true,
      };
    case 'IN_PROGRESS':
      return {
        headline: 'Tocca a lei',
        detail:
          bayCode === null
            ? "Si presenti all'accettazione."
            : `Si presenti allo sportello ${bayCode}.`,
        tone: 'serving',
        showAheadCount: false,
      };
    case 'COMPLETED':
      // È un servizio in fila, in auto: finito il check-in con l'accettatore, l'accettazione è
      // conclusa e il cliente può ripartire. Il ritiro a fine riparazione è un altro processo e
      // non si annuncia qui — promettere un avviso da questa pagina era una promessa di un'altra.
      return {
        headline: 'Accettazione conclusa',
        detail: "Grazie: può ripartire. La sua auto resta in officina per l'intervento.",
        tone: 'done',
        showAheadCount: false,
      };
    case 'NO_SHOW':
      return {
        headline: 'Appuntamento chiuso',
        detail: "Se è ancora qui, si rivolga all'accettazione. Altrimenti la richiamiamo noi.",
        tone: 'attention',
        showAheadCount: false,
      };
    case 'CANCELLED':
      return {
        headline: 'Appuntamento annullato',
        detail: "Per informazioni si rivolga all'accettazione.",
        tone: 'attention',
        showAheadCount: false,
      };
  }
}

/** Schermata per una pratica conclusa da tempo o di una giornata passata. */
export function concludedMessage(status: AppointmentStatus): StatusMessage {
  switch (status) {
    case 'COMPLETED':
      return {
        headline: 'Pratica conclusa',
        detail: "Questo appuntamento è già stato gestito. Per informazioni chiami l'officina.",
        tone: 'done',
        showAheadCount: false,
      };
    case 'CANCELLED':
      return {
        headline: 'Appuntamento annullato',
        detail: "Questo appuntamento non è più attivo. Per fissarne un altro chiami l'officina.",
        tone: 'attention',
        showAheadCount: false,
      };
    case 'NO_SHOW':
      return {
        headline: 'Appuntamento non utilizzato',
        detail: "Per fissare un nuovo appuntamento chiami l'officina.",
        tone: 'attention',
        showAheadCount: false,
      };
    default:
      return {
        headline: 'Appuntamento passato',
        detail: "Questa pagina è di un giorno passato. Per oggi si rivolga all'accettazione.",
        tone: 'attention',
        showAheadCount: false,
      };
  }
}

/** Riga sulle auto in fila prima del cliente. */
export function aheadCountMessage(aheadCount: number): string {
  if (aheadCount === 0) {
    // «È il prossimo» costringerebbe a scegliere un genere: il turno non ne ha.
    return 'Il prossimo turno è il suo';
  }
  return aheadCount === 1 ? "C'è 1 auto prima di lei" : `Ci sono ${aheadCount} auto prima di lei`;
}
