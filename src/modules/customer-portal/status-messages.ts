// Messaggi di cortesia mostrati al cliente per ogni stato della pratica (modulo B).
// Testi separati dai componenti: sono la parte che il committente rivedrà più spesso.
import type { AppointmentStatus } from '@/domain/entities/appointment';

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

/** Messaggio per lo stato, con la campata quando la vettura è in lavorazione. */
export function statusMessage(status: AppointmentStatus, bayNumber: number | null): StatusMessage {
  switch (status) {
    case 'WAITING':
      return {
        headline: 'Attendi la chiamata',
        detail: 'Ti avviseremo quando sarà il tuo turno. Resta in sala di attesa.',
        tone: 'waiting',
        showAheadCount: true,
      };
    case 'SKIPPED':
      return {
        headline: 'Ancora in attesa',
        detail: 'Il tuo turno è stato posticipato di poco: rimani in sala, ti chiamiamo a breve.',
        tone: 'waiting',
        showAheadCount: true,
      };
    case 'IN_PROGRESS':
      return {
        headline: 'È il tuo turno',
        detail:
          bayNumber === null
            ? "Procedi in corsia: l'accettatore ti sta aspettando."
            : `Procedi all'accettazione ${bayNumber}: l'accettatore ti sta aspettando.`,
        tone: 'serving',
        showAheadCount: false,
      };
    case 'COMPLETED':
      return {
        headline: 'Accettazione completata',
        detail: 'La presa in carico del veicolo è conclusa. Grazie per la pazienza.',
        tone: 'done',
        showAheadCount: false,
      };
    case 'NO_SHOW':
      return {
        headline: 'Non ti abbiamo trovato',
        detail: "Il turno è stato chiuso come assente: rivolgiti allo sportello dell'accettazione.",
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

/** Riga sul numero di clienti in attesa prima del cliente. */
export function aheadCountMessage(aheadCount: number): string {
  if (aheadCount === 0) {
    return 'Sei il prossimo';
  }
  return aheadCount === 1
    ? "C'è 1 cliente prima di te"
    : `Ci sono ${aheadCount} clienti prima di te`;
}
