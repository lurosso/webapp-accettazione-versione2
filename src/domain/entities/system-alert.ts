// Segnalazione di una disfunzione fatta dal personale all'amministratore, dalla pagina Sistema.
//
// Non è un log tecnico: è il modo in cui chi sta al banco dice «Infinity non risponde», «la
// stampante non stampa», «il tablet non carica i video» a chi può intervenire, con il codice del
// controllo che ha visto rosso, chi l'ha detto e da quale postazione, e lo stato in cui
// l'amministratore la sta portando (nuova → in gestione → risolta).
import type { OperatorId, SystemAlertId, WorkstationId } from '../ids';
import type { IsoDateTime } from '../value-objects/iso-date';

/** I componenti su cui si può segnalare qualcosa: i controlli della pagina Sistema più l'hardware. */
export const SYSTEM_ALERT_COMPONENTS = [
  'INFINITY',
  'SPOKI',
  'SMS_HOSTING',
  'CRM',
  'MEDIA_STORAGE',
  'NETWORK',
  'SYNC',
  'HARDWARE',
  'OTHER',
] as const;

export type SystemAlertComponent = (typeof SYSTEM_ALERT_COMPONENTS)[number];

/** Etichette in italiano, condivise da pagina Sistema e cruscotto Admin. */
export const SYSTEM_ALERT_COMPONENT_LABELS: Readonly<Record<SystemAlertComponent, string>> = {
  INFINITY: 'Infinity DMS (agenda)',
  SPOKI: 'Spoki (WhatsApp)',
  SMS_HOSTING: 'SMS Hosting (SMS di ripiego)',
  CRM: 'CRM / BDC',
  MEDIA_STORAGE: 'Storage media / disco',
  NETWORK: 'Rete / connettività',
  SYNC: 'Sincronizzazione agenda',
  HARDWARE: 'Stampanti / hardware',
  OTHER: 'Altro',
};

export const SYSTEM_ALERT_STATUSES = ['NEW', 'IN_PROGRESS', 'RESOLVED'] as const;

export type SystemAlertStatus = (typeof SYSTEM_ALERT_STATUSES)[number];

export const SYSTEM_ALERT_STATUS_LABELS: Readonly<Record<SystemAlertStatus, string>> = {
  NEW: 'Nuova',
  IN_PROGRESS: 'In gestione',
  RESOLVED: 'Risolta',
};

export interface SystemAlert {
  readonly id: SystemAlertId;
  /** Codice del controllo o della segnalazione, es. `INFINITY-DOWN`, `HARDWARE-MANUALE`. */
  readonly code: string;
  readonly component: SystemAlertComponent;
  /** Cosa è stato visto, nelle parole del controllo o dell'operatore. */
  readonly message: string;
  readonly status: SystemAlertStatus;
  readonly reportedByOperatorId: OperatorId;
  readonly reportedByName: string;
  readonly workstationId: WorkstationId | null;
  readonly workstationName: string | null;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  /** Chi l'ha presa in gestione o risolta. */
  readonly handledByOperatorId: OperatorId | null;
  readonly handledByName: string | null;
  readonly resolvedAt: IsoDateTime | null;
  /** Nota dell'amministratore (cosa ha fatto, cosa manca). */
  readonly adminNote: string | null;
}

export function isSystemAlertComponent(value: string): value is SystemAlertComponent {
  return (SYSTEM_ALERT_COMPONENTS as readonly string[]).includes(value);
}

export function isSystemAlertStatus(value: string): value is SystemAlertStatus {
  return (SYSTEM_ALERT_STATUSES as readonly string[]).includes(value);
}

/**
 * Passaggi ammessi. Da nuova si prende in gestione o si chiude subito; da in gestione si chiude
 * o si rimette fra le nuove (passata a un collega); una risolta si può riaprire.
 */
export function canTransitionAlert(from: SystemAlertStatus, to: SystemAlertStatus): boolean {
  if (from === to) {
    return false;
  }
  switch (from) {
    case 'NEW':
      return to === 'IN_PROGRESS' || to === 'RESOLVED';
    case 'IN_PROGRESS':
      return to === 'RESOLVED' || to === 'NEW';
    case 'RESOLVED':
      return to === 'NEW';
  }
}
