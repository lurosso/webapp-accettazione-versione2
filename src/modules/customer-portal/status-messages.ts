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
  /** Il conteggio "clienti prima di te" ha senso solo mentre si è in coda. */
  readonly showAheadCount: boolean;
}

/** Le quattro tappe del percorso del veicolo, nell'ordine mostrato dalla barra di avanzamento. */
export const PORTAL_STAGES: readonly { readonly stage: PortalStage; readonly label: string }[] = [
  { stage: 1, label: 'In attesa' },
  { stage: 2, label: 'In accettazione' },
  { stage: 3, label: 'In lavorazione' },
  { stage: 4, label: 'Pronta per il ritiro' },
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
 */
export function statusMessage(status: AppointmentStatus, bayCode: string | null): StatusMessage {
  switch (status) {
    case 'WAITING':
      return {
        headline: 'Sei in fila',
        detail: 'Attendi in auto: ti chiamiamo noi quando è il tuo turno.',
        tone: 'waiting',
        showAheadCount: true,
      };
    case 'SKIPPED':
      return {
        headline: 'Ancora in fila',
        detail: 'Il tuo turno è stato posticipato di poco: resta in auto, ti chiamiamo a breve.',
        tone: 'waiting',
        showAheadCount: true,
      };
    case 'IN_PROGRESS':
      return {
        headline: 'Tocca a te',
        detail:
          bayCode === null
            ? "Avanza verso l'accettazione: l'accettatore ti sta aspettando."
            : `Avanza verso lo sportello ${bayCode}: l'accettatore ti sta aspettando.`,
        tone: 'serving',
        showAheadCount: false,
      };
    case 'COMPLETED':
      return {
        headline: 'Vettura in lavorazione',
        detail:
          "L'accettazione è conclusa e la vettura è in officina. Ti avviseremo quando sarà pronta per il ritiro.",
        tone: 'done',
        showAheadCount: false,
      };
    case 'NO_SHOW':
      return {
        headline: 'Non ti abbiamo trovato',
        detail:
          "Il turno è stato chiuso come assente: se sei ancora qui, avvicinati a uno sportello dell'accettazione.",
        tone: 'attention',
        showAheadCount: false,
      };
    case 'CANCELLED':
      return {
        headline: 'Appuntamento annullato',
        detail: "L'appuntamento di oggi non risulta più in agenda: rivolgiti allo sportello.",
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
          "Questo appuntamento è stato gestito. Per informazioni sulla vettura rivolgiti all'officina; per un nuovo appuntamento contatta Autoclub Group.",
        tone: 'done',
        showAheadCount: false,
      };
    case 'CANCELLED':
      return {
        headline: 'Appuntamento annullato',
        detail:
          'Questo appuntamento non è più attivo. Per fissarne uno nuovo contatta Autoclub Group.',
        tone: 'attention',
        showAheadCount: false,
      };
    case 'NO_SHOW':
      return {
        headline: 'Appuntamento non utilizzato',
        detail:
          "L'appuntamento risulta chiuso come assente. Per fissarne uno nuovo contatta Autoclub Group.",
        tone: 'attention',
        showAheadCount: false,
      };
    default:
      return {
        headline: 'Appuntamento di una giornata passata',
        detail:
          "Questa pagina si riferisce a un appuntamento già trascorso. Per oggi rivolgiti all'accettazione.",
        tone: 'attention',
        showAheadCount: false,
      };
  }
}

/** Riga sulle auto in fila prima del cliente. */
export function aheadCountMessage(aheadCount: number): string {
  if (aheadCount === 0) {
    return 'Sei il prossimo';
  }
  return aheadCount === 1 ? "C'è 1 auto prima di te" : `Ci sono ${aheadCount} auto prima di te`;
}
