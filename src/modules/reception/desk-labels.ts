// Etichette degli sportelli nella coda: sempre lo sportello ESATTO, mai l'area accorpata.
//
// Prima una pratica di un altro banco diceva «S1 · Sportelli A e B», cioè l'area di marchio: vero
// ma inutile a chi deve capire al volo dove sta la vettura. Ora una pratica in carico dice lo
// sportello fisico che la sta servendo («Sportello B»); una pratica in attesa non è a nessuno
// sportello, e allora dice di quale coda fa parte e quali sportelli la servono («Coda A/B»),
// senza spacciare l'area per una postazione.
import type { Bay } from '@/domain/entities/bay';
import type { Desk } from '@/domain/entities/desk';
import type { Workstation } from '@/domain/entities/workstation';
import type { QueueRowView } from '@/domain/read-models';

/** Il minimo che serve di uno sportello per etichettare: la lettera e l'area che lo raggruppa. */
export interface BayForLabel {
  readonly bay: { readonly code: string };
  readonly deskId: string | null;
}

/** L'area di marchio che serve la pratica: quella assegnata, altrimenti quella del marchio. */
export function deskOf(row: QueueRowView, desks: readonly Desk[]): Desk | null {
  const a = row.appointment;
  if (a.deskId !== null) {
    return desks.find((d) => d.id === a.deskId) ?? null;
  }
  return desks.find((d) => d.brandIds.includes(a.brandId)) ?? null;
}

/** Le lettere degli sportelli che servono un'area, in ordine. */
export function bayCodesOfDesk(deskId: string, bays: readonly BayForLabel[]): readonly string[] {
  return bays
    .filter((b) => b.deskId === deskId)
    .map((b) => b.bay.code)
    .sort((x, y) => x.localeCompare(y));
}

/**
 * Lo sportello non sa a quale area appartiene: lo si deduce dalla postazione che lo ha come
 * predefinito (la postazione conosce la propria area). Uno sportello senza postazione resta
 * senza area e non concorre a nessuna etichetta.
 */
export function baysForLabel(
  bays: readonly Bay[],
  workstations: readonly Workstation[],
): readonly BayForLabel[] {
  return bays.map((bay) => ({
    bay: { code: bay.code },
    deskId: workstations.find((w) => w.defaultBayId === bay.id)?.deskId ?? null,
  }));
}

/**
 * Come si chiama un'area quando non c'è uno sportello preciso: «Coda A/B» se la servono più
 * sportelli, «Sportello C» se ne ha uno solo, il suo nome se non si sa altro.
 */
export function codaLabel(desk: Pick<Desk, 'id' | 'name'>, bays: readonly BayForLabel[]): string {
  const lettere = bayCodesOfDesk(desk.id, bays);
  if (lettere.length === 1) {
    return `Sportello ${lettere[0]}`;
  }
  if (lettere.length > 1) {
    return `Coda ${lettere.join('/')}`;
  }
  return desk.name;
}

/**
 * «Sportello B» se la pratica è a uno sportello; «Coda A/B» se è in attesa in un'area con più
 * sportelli; «Sportello C» se l'area ne ha uno solo; il nome dell'area se non si sa altro.
 */
export function sportelloLabel(
  row: QueueRowView,
  desks: readonly Desk[],
  bays: readonly BayForLabel[],
): string | null {
  if (row.bayCode !== null) {
    return `Sportello ${row.bayCode}`;
  }
  const desk = deskOf(row, desks);
  return desk === null ? null : codaLabel(desk, bays);
}
