// Messaggi di cortesia mostrati al cliente per ogni stato della pratica (modulo B) e tappe del
// percorso. Testi separati dai componenti: sono la parte che il committente rivedrà più spesso.
import type { AppointmentStatus } from '@/domain/entities/appointment';
import type { PortalStage } from '@/domain/read-models';

/** Tono grafico della schermata, coerente con i token colore degli stati. */
export type StatusTone = 'waiting' | 'serving' | 'done' | 'attention';

export interface StatusMessage {
  /** Titolo grande, la prima cosa che il cliente legge. */
  readonly headline: string;
  /** Riga di dettaglio sotto il titolo. */
  readonly detail: string;
  readonly tone: StatusTone;
  /** Il conteggio "auto prima di lei" ha senso solo mentre si è in coda. */
  readonly showAheadCount: boolean;
}

/**
 * Le tre tappe del percorso, nell'ordine mostrato dalla barra di avanzamento. Il percorso che
 * questa pagina racconta è l'ACCETTAZIONE — la fila, lo sportello, il check-in — e finisce quando
 * il cliente riparte. Il ritiro a fine riparazione lo comunica l'officina per altra via: una
 * quarta tappa «Pronta per il ritiro» qui restava grigia per giorni e faceva sembrare la pratica
 * ferma a metà.
 */
export const PORTAL_STAGES: readonly { readonly stage: PortalStage; readonly label: string }[] = [
  { stage: 1, label: 'In attesa' },
  { stage: 2, label: 'In accettazione' },
  { stage: 3, label: 'Accettazione conclusa' },
];

/** Etichetta della tappa corrente. */
export function stageLabel(stage: PortalStage): string {
  return PORTAL_STAGES.find((s) => s.stage === stage)?.label ?? 'In attesa';
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
        detail: 'Resti pure in auto: la chiamiamo noi quando arriva il suo turno.',
        tone: 'waiting',
        showAheadCount: true,
      };
    case 'SKIPPED':
      return {
        headline: 'Ancora in fila',
        detail: 'Il suo turno è stato posticipato di poco: resti in auto, la chiamiamo a breve.',
        tone: 'waiting',
        showAheadCount: true,
      };
    case 'IN_PROGRESS':
      return {
        headline: 'Tocca a lei',
        detail:
          bayCode === null
            ? "Si presenti all'accettazione: l'accettatore la sta aspettando."
            : `Si presenti allo sportello ${bayCode}: l'accettatore la sta aspettando.`,
        tone: 'serving',
        showAheadCount: false,
      };
    case 'COMPLETED':
      // È un servizio in fila, in auto: finito il check-in con l'accettatore, l'accettazione è
      // conclusa e il cliente può ripartire. Il ritiro a fine riparazione è un altro processo e
      // non si annuncia qui — promettere un avviso da questa pagina era una promessa di un'altra.
      return {
        headline: 'Accettazione conclusa',
        detail:
          'Grazie per la visita: la procedura è finita e può ripartire. La vettura rimane in officina per la lavorazione.',
        tone: 'done',
        showAheadCount: false,
      };
    case 'NO_SHOW':
      return {
        headline: "L'appuntamento di oggi è chiuso",
        detail:
          "Il suo arrivo non risulta registrato. Se è ancora in officina si rivolga a uno sportello dell'accettazione; altrimenti la richiamiamo noi per fissare una nuova data.",
        tone: 'attention',
        showAheadCount: false,
      };
    case 'CANCELLED':
      return {
        headline: 'Appuntamento annullato',
        detail: "L'appuntamento di oggi non risulta più in agenda: si rivolga allo sportello.",
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
        detail:
          "Questo appuntamento è stato gestito. Per informazioni sulla vettura si rivolga all'officina; per un nuovo appuntamento contatti Autoclub Group.",
        tone: 'done',
        showAheadCount: false,
      };
    case 'CANCELLED':
      return {
        headline: 'Appuntamento annullato',
        detail:
          'Questo appuntamento non è più attivo. Per fissarne uno nuovo contatti Autoclub Group.',
        tone: 'attention',
        showAheadCount: false,
      };
    case 'NO_SHOW':
      return {
        headline: 'Appuntamento non utilizzato',
        detail:
          "L'appuntamento risulta chiuso per mancato arrivo. Per fissarne uno nuovo contatti Autoclub Group.",
        tone: 'attention',
        showAheadCount: false,
      };
    default:
      return {
        headline: 'Appuntamento di una giornata passata',
        detail:
          "Questa pagina si riferisce a un appuntamento già trascorso. Per oggi si rivolga all'accettazione.",
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
