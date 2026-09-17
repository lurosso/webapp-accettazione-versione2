import { describe, expect, it } from 'vitest';
import {
  buildLoginOptions,
  defaultLoginOption,
  deskDisplayName,
} from '@/application/auth/login-options';
import { workstationAvailability } from '@/application/auth/workstation-availability';
import type { WorkstationClaim } from '@/domain/entities/workstation-claim';
import { asOperatorId, asWorkstationId } from '@/domain/ids';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import { buildTestEnv } from '../helpers/fixtures';

const NOW = '2026-09-10T08:00:00.000Z' as IsoDateTime;

function claim(ws: string, operatorName: string): WorkstationClaim {
  return {
    workstationId: asWorkstationId(ws),
    operatorId: asOperatorId(`op-${ws}`),
    operatorName,
    claimedAt: NOW,
    expiresAt: '2026-09-10T16:00:00.000Z' as IsoDateTime,
  };
}

describe('Menu unico del login', () => {
  const { seed } = buildTestEnv();

  it('propone i quattro sportelli A-D, ognuno con la propria area per marchio e i marchi', () => {
    const options = buildLoginOptions({
      workstations: seed.workstations,
      desks: seed.desks,
      brands: seed.brands,
      availability: workstationAvailability({
        workstations: seed.workstations,
        claims: [],
        busyBays: [],
        now: NOW,
      }),
    });
    expect(options).toHaveLength(4);
    // La lettera è quella sulla targhetta del banco; il codice dice quali marchi si servono lì.
    expect(options.map((o) => o.label)).toEqual([
      'Sportello A · FCA',
      'Sportello B · FCA',
      'Sportello C · PSA',
      'Sportello D · PSA',
    ]);
    expect(options[0]?.brands).toEqual(['Fiat', 'Lancia', 'Jeep', 'Alfa Romeo']);
    expect(options[3]?.brands).toEqual(['Peugeot', 'Citroën', 'Opel']);
    expect(options.every((o) => !o.disabled && o.reason === null)).toBe(true);
    expect(defaultLoginOption(options)).toBe('ws-p1');
  });

  it('uno sportello occupato resta in elenco ma non è selezionabile, e non è quello proposto', () => {
    const options = buildLoginOptions({
      workstations: seed.workstations,
      desks: seed.desks,
      brands: seed.brands,
      availability: workstationAvailability({
        workstations: seed.workstations,
        claims: [claim('ws-p1', 'Mario Rossi')],
        busyBays: [{ bayId: 'bay-c2', code: 'F007', operatorId: null, operatorName: null }],
        now: NOW,
      }),
    });
    expect(options.map((o) => o.disabled)).toEqual([true, true, false, false]);
    expect(options[0]?.reason).toBe('in uso da Mario Rossi');
    expect(options[1]?.reason).toBe('veicolo F007 in carico');
    expect(defaultLoginOption(options)).toBe('ws-p3');
  });

  it('con tutti gli sportelli occupati non ne propone nessuno', () => {
    const options = buildLoginOptions({
      workstations: seed.workstations,
      desks: seed.desks,
      brands: seed.brands,
      availability: workstationAvailability({
        workstations: seed.workstations,
        claims: seed.workstations.map((w) => claim(w.id, 'Qualcuno')),
        busyBays: [],
        now: NOW,
      }),
    });
    expect(options.every((o) => o.disabled)).toBe(true);
    expect(defaultLoginOption(options)).toBe('');
  });

  it("nel menu l'area si legge dal codice (FCA, PSA); senza codice resta il nome", () => {
    expect(deskDisplayName({ code: 'FCA', name: 'Sportelli A e B' })).toBe('FCA');
    expect(deskDisplayName({ code: '', name: 'Jeep / Alfa Romeo' })).toBe('Jeep / Alfa Romeo');
  });
});
