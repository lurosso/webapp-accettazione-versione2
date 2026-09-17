// Quali sportelli proporre al login: solo quelli liberi.
//
// Uno sportello è occupato quando un collega ci è collegato (occupazione registrata al login,
// valida fino alla scadenza della sua sessione) oppure quando c'è un veicolo in carico al banco
// che gli corrisponde. Nel secondo caso il collega potrebbe anche aver perso la sessione,
// ma il posto è comunque "suo" finché la pratica non si chiude. Funzione pura: la pagina di login
// e i test la usano con gli stessi dati.
import type { Workstation } from '@/domain/entities/workstation';
import type { WorkstationClaim } from '@/domain/entities/workstation-claim';
import { isClaimActive } from '@/domain/entities/workstation-claim';
import type { OperatorId } from '@/domain/ids';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';

export interface BusyBay {
  readonly bayId: string;
  /** Codice della pratica in carico, mostrato a chi trova il posto occupato. */
  readonly code: string;
  readonly operatorId: OperatorId | null;
  readonly operatorName: string | null;
}

export interface OccupiedWorkstation {
  readonly workstation: Workstation;
  /** Testo pronto per la UI: "in uso da Mario Rossi" oppure "veicolo F012 in carico". */
  readonly reason: string;
}

export interface WorkstationAvailability {
  readonly free: readonly Workstation[];
  readonly occupied: readonly OccupiedWorkstation[];
}

export interface AvailabilityInput {
  readonly workstations: readonly Workstation[];
  readonly claims: readonly WorkstationClaim[];
  readonly busyBays: readonly BusyBay[];
  readonly now: IsoDateTime;
  /**
   * Operatore che sta facendo il login, se noto: i posti occupati da lui stesso (sessione
   * precedente non chiusa, veicolo che ha in carico) restano selezionabili.
   */
  readonly forOperatorId?: OperatorId | null;
}

export function workstationAvailability(input: AvailabilityInput): WorkstationAvailability {
  const forOperator = input.forOperatorId ?? null;
  const free: Workstation[] = [];
  const occupied: OccupiedWorkstation[] = [];

  for (const ws of input.workstations) {
    const claim = input.claims.find(
      (c) => c.workstationId === ws.id && isClaimActive(c, input.now),
    );
    if (claim !== undefined && claim.operatorId !== forOperator) {
      occupied.push({ workstation: ws, reason: `in uso da ${claim.operatorName}` });
      continue;
    }
    const bay =
      ws.defaultBayId === null
        ? undefined
        : input.busyBays.find((b) => b.bayId === ws.defaultBayId);
    if (bay !== undefined && (forOperator === null || bay.operatorId !== forOperator)) {
      occupied.push({
        workstation: ws,
        reason:
          bay.operatorName === null
            ? `veicolo ${bay.code} in carico`
            : `veicolo ${bay.code} in carico a ${bay.operatorName}`,
      });
      continue;
    }
    free.push(ws);
  }

  return { free, occupied };
}
