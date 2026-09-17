// Il menu unico del login: quattro voci "Sportello A · FCA", con le occupate non selezionabili e
// il motivo accanto. Area per marchio e postazione erano due menu separati, ma nel dominio ogni
// postazione appartiene a una sola area: scegliere lo sportello fisico basta, e la lettera è la
// stessa che l'accettatore ha sulla targhetta davanti.
// Funzione pura, condivisa da pagina di login e test.
import type { Brand } from '@/domain/entities/brand';
import type { Desk } from '@/domain/entities/desk';
import type { Workstation } from '@/domain/entities/workstation';
import type { WorkstationAvailability } from './workstation-availability';

export interface LoginWorkstationOption {
  readonly id: string;
  /** "Sportello A · FCA" */
  readonly label: string;
  /** Marchi serviti dall'area della postazione, per i badge sotto al menu. */
  readonly brands: readonly string[];
  readonly deskId: string;
  readonly disabled: boolean;
  /** Perché non è selezionabile ("in uso da Mario Rossi"); null se libera. */
  readonly reason: string | null;
}

export interface LoginOptionsInput {
  readonly workstations: readonly Workstation[];
  readonly desks: readonly Desk[];
  readonly brands: readonly Brand[];
  readonly availability: WorkstationAvailability;
}

/**
 * Come si chiama l'area nel menu: il codice (FCA, PSA) sta in una riga sola accanto alla lettera
 * dello sportello, mentre il nome esteso ("Sportelli A e B") ripeterebbe la lettera già scritta.
 */
export function deskDisplayName(desk: Pick<Desk, 'code' | 'name'>): string {
  return desk.code.trim() === '' ? desk.name.trim() : desk.code.trim();
}

export function buildLoginOptions(input: LoginOptionsInput): readonly LoginWorkstationOption[] {
  const occupied = new Map(
    input.availability.occupied.map((o) => [o.workstation.id, o.reason] as const),
  );
  return [...input.workstations]
    .sort((x, y) => x.name.localeCompare(y.name, 'it', { numeric: true }))
    .map((ws) => {
      const desk = input.desks.find((d) => d.id === ws.deskId) ?? null;
      const reason = occupied.get(ws.id) ?? null;
      return {
        id: ws.id,
        label: desk === null ? ws.name : `${ws.name} · ${deskDisplayName(desk)}`,
        brands:
          desk === null
            ? []
            : desk.brandIds.map((id) => input.brands.find((b) => b.id === id)?.name ?? id),
        deskId: ws.deskId,
        disabled: reason !== null,
        reason,
      };
    });
}

/** Primo sportello libero da proporre selezionato; '' se sono tutti occupati. */
export function defaultLoginOption(options: readonly LoginWorkstationOption[]): string {
  return options.find((o) => !o.disabled)?.id ?? '';
}
