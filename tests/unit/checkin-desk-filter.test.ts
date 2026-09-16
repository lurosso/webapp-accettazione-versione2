import { describe, expect, it } from 'vitest';
import { buildSeedData } from '@/config/seed';
import { deskIdOf, visibleOnDesk } from '@/domain/queue-position';
import { asBrandId, asDeskId } from '@/domain/ids';
import { makeAppointment } from '../helpers/fixtures';

const seed = buildSeedData();
const fiat = asBrandId('brand-fiat');
const jeep = asBrandId('brand-jeep');

describe('Sportello di una pratica (tablet check-in e dashboard)', () => {
  it('una pratica nata dalla sync (deskId nullo) appartiene allo sportello che serve il marchio', () => {
    const daInfinity = makeAppointment({ deskId: null, brandId: fiat });
    expect(deskIdOf(daInfinity, seed.desks)).toBe(asDeskId('desk-s1'));
    expect(visibleOnDesk(daInfinity, seed.desks, 'desk-s1')).toBe(true);
    expect(visibleOnDesk(daInfinity, seed.desks, 'desk-s2')).toBe(false);
    // Vista globale (nessuno sportello scelto): si vede tutto.
    expect(visibleOnDesk(daInfinity, seed.desks, null)).toBe(true);
  });

  it('lo sportello assegnato prevale sul marchio', () => {
    const spostata = makeAppointment({ deskId: asDeskId('desk-s2'), brandId: fiat });
    expect(deskIdOf(spostata, seed.desks)).toBe(asDeskId('desk-s2'));
    expect(visibleOnDesk(spostata, seed.desks, 'desk-s2')).toBe(true);
    expect(visibleOnDesk(spostata, seed.desks, 'desk-s1')).toBe(false);
  });

  it('una pratica di un marchio che nessuno sportello serve non sparisce: la vedono tutti', () => {
    const orfana = makeAppointment({ deskId: null, brandId: asBrandId('brand-sconosciuto') });
    expect(deskIdOf(orfana, seed.desks)).toBeNull();
    expect(visibleOnDesk(orfana, seed.desks, 'desk-s1')).toBe(true);
    expect(visibleOnDesk(orfana, seed.desks, 'desk-s2')).toBe(true);
    const jeepS2 = makeAppointment({ deskId: null, brandId: jeep });
    expect(deskIdOf(jeepS2, seed.desks)).toBe(asDeskId('desk-s2'));
  });
});
