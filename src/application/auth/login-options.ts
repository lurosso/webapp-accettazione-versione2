// Il menu unico del login: quattro voci "Accettazione N · marchi serviti", con le occupate non
// selezionabili e il motivo accanto. Sportello e postazione erano due menu separati, ma nel
// dominio ogni postazione appartiene a un solo sportello: scegliere l'accettazione basta.
// Funzione pura, condivisa da pagina di login e test.
import type { Brand } from '@/domain/entities/brand';
import type { Desk } from '@/domain/entities/desk';
import type { Workstation } from '@/domain/entities/workstation';
import type { WorkstationAvailability } from './workstation-availability';

export interface LoginWorkstationOption {
  readonly id: string;
  /** "Accettazione 1 · Stellantis Italia" */
  readonly label: string;
  /** Marchi serviti dallo sportello della postazione, per i badge sotto al menu. */
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

/** "Sportello Stellantis Italia" → "Stellantis Italia": la parola sportello nel menu non aiuta. */
export function deskDisplayName(desk: Pick<Desk, 'name'>): string {
  return desk.name.replace(/^sportello\s+/i, '').trim();
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

/** Prima accettazione libera da proporre selezionata; '' se sono tutte occupate. */
export function defaultLoginOption(options: readonly LoginWorkstationOption[]): string {
  return options.find((o) => !o.disabled)?.id ?? '';
}
