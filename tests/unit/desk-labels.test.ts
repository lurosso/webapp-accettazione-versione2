// Etichette degli sportelli nella coda: lo sportello esatto per chi è in carico, la coda con le
// sue lettere per chi aspetta, mai l'area accorpata «Sportelli A e B».
import { describe, expect, it } from 'vitest';
import type { Desk } from '@/domain/entities/desk';
import { asBrandId, asDeskId } from '@/domain/ids';
import type { QueueRowView } from '@/domain/read-models';
import type { Bay } from '@/domain/entities/bay';
import type { Workstation } from '@/domain/entities/workstation';
import { asBayId, asWorkstationId } from '@/domain/ids';
import {
  bayCodesOfDesk,
  baysForLabel,
  codaLabel,
  deskOf,
  sportelloLabel,
} from '@/modules/reception/desk-labels';
import { makeAppointment } from '../helpers/fixtures';

const desks: readonly Desk[] = [
  {
    id: asDeskId('desk-s1'),
    code: 'S1',
    name: 'Sportelli A e B',
    brandIds: [asBrandId('brand-fiat')],
    isActive: true,
  },
  {
    id: asDeskId('desk-s2'),
    code: 'S2',
    name: 'Sportelli C e D',
    brandIds: [asBrandId('brand-peugeot')],
    isActive: true,
  },
  {
    id: asDeskId('desk-s3'),
    code: 'S3',
    name: 'Sportello E',
    brandIds: [asBrandId('brand-altro')],
    isActive: true,
  },
];

const bays = [
  { bay: { code: 'B' }, deskId: 'desk-s1' },
  { bay: { code: 'A' }, deskId: 'desk-s1' },
  { bay: { code: 'C' }, deskId: 'desk-s2' },
  { bay: { code: 'D' }, deskId: 'desk-s2' },
  { bay: { code: 'E' }, deskId: 'desk-s3' },
];

function riga(
  overrides: Partial<QueueRowView['appointment']>,
  bayCode: string | null,
): QueueRowView {
  return {
    appointment: makeAppointment(overrides),
    operatorName: null,
    bayCode,
    notificationStatus: null,
    notificationChannel: null,
  };
}

describe('Etichetta dell’area (intestazione della postazione)', () => {
  const bay = (code: string, n: 1 | 2 | 3 | 4): Bay => ({
    id: asBayId(`bay-${code}`),
    code,
    number: n,
    name: `Sportello ${code}`,
    displayToken: 'x',
    isActive: true,
  });
  const postazione = (id: string, deskId: string, bayCode: string | null): Workstation => ({
    id: asWorkstationId(id),
    code: id.toUpperCase(),
    name: `Postazione ${id}`,
    deskId: asDeskId(deskId),
    defaultBayId: bayCode === null ? null : asBayId(`bay-${bayCode}`),
  });

  it('lo sportello prende l’area dalla postazione che lo ha come predefinito', () => {
    const collegati = baysForLabel(
      [bay('A', 1), bay('B', 2), bay('C', 3), bay('D', 4)],
      [
        postazione('p1', 'desk-s1', 'A'),
        postazione('p2', 'desk-s1', 'B'),
        postazione('p3', 'desk-s2', 'C'),
        postazione('p9', 'desk-s3', null),
      ],
    );
    expect(collegati.map((b) => [b.bay.code, b.deskId])).toEqual([
      ['A', 'desk-s1'],
      ['B', 'desk-s1'],
      ['C', 'desk-s2'],
      ['D', null],
    ]);
    expect(codaLabel(desks[0]!, collegati)).toBe('Coda A/B');
    expect(codaLabel(desks[1]!, collegati)).toBe('Sportello C');
    expect(codaLabel(desks[2]!, collegati)).toBe('Sportello E');
  });
});

describe('Etichette degli sportelli', () => {
  it('una pratica in carico dice lo sportello fisico che la sta servendo', () => {
    const r = riga({ status: 'IN_PROGRESS', deskId: asDeskId('desk-s1') }, 'B');
    expect(sportelloLabel(r, desks, bays)).toBe('Sportello B');
  });

  it('una pratica in attesa in un’area a due sportelli dice la coda e le lettere, in ordine', () => {
    const r = riga({ status: 'WAITING', deskId: asDeskId('desk-s1') }, null);
    expect(sportelloLabel(r, desks, bays)).toBe('Coda A/B');
    expect(bayCodesOfDesk('desk-s2', bays)).toEqual(['C', 'D']);
  });

  it('un’area con un solo sportello è già puntuale anche in attesa', () => {
    const r = riga({ status: 'WAITING', deskId: asDeskId('desk-s3') }, null);
    expect(sportelloLabel(r, desks, bays)).toBe('Sportello E');
  });

  it('senza sportello assegnato l’area si deduce dal marchio; senza sportelli noti resta il nome dell’area', () => {
    const r = riga({ status: 'WAITING', deskId: null, brandId: asBrandId('brand-peugeot') }, null);
    expect(deskOf(r, desks)?.id).toBe('desk-s2');
    expect(sportelloLabel(r, desks, bays)).toBe('Coda C/D');
    expect(sportelloLabel(r, desks, [])).toBe('Sportelli C e D');
    const ignota = riga(
      { status: 'WAITING', deskId: null, brandId: asBrandId('brand-sconosciuto') },
      null,
    );
    expect(sportelloLabel(ignota, desks, bays)).toBeNull();
  });
});
