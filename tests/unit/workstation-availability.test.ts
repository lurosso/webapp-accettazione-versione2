import { describe, expect, it } from 'vitest';
import { workstationAvailability } from '@/application/auth/workstation-availability';
import type { WorkstationClaim } from '@/domain/entities/workstation-claim';
import { asOperatorId, asWorkstationId } from '@/domain/ids';
import type { IsoDateTime } from '@/domain/value-objects/iso-date';
import { buildTestEnv } from '../helpers/fixtures';

const NOW = '2026-09-10T08:00:00.000Z' as IsoDateTime;

function claim(
  ws: string,
  operatorId: string,
  operatorName: string,
  hoursLeft = 8,
): WorkstationClaim {
  return {
    workstationId: asWorkstationId(ws),
    operatorId: asOperatorId(operatorId),
    operatorName,
    claimedAt: NOW,
    expiresAt: new Date(
      new Date(NOW).getTime() + hoursLeft * 3_600_000,
    ).toISOString() as IsoDateTime,
  };
}

describe('workstationAvailability: accettazioni libere al login', () => {
  const { seed } = buildTestEnv();
  const tutte = seed.workstations;

  it('senza occupazioni né veicoli in carico sono tutte libere', () => {
    const r = workstationAvailability({ workstations: tutte, claims: [], busyBays: [], now: NOW });
    expect(r.free.map((w) => w.name)).toEqual([
      'Accettazione 1',
      'Accettazione 2',
      'Accettazione 3',
      'Accettazione 4',
    ]);
    expect(r.occupied).toEqual([]);
  });

  it("un'accettazione con un collega collegato sparisce dalle libere, con il suo nome", () => {
    const r = workstationAvailability({
      workstations: tutte,
      claims: [claim('ws-p1', 'op-advisor-1', 'Mario Rossi')],
      busyBays: [],
      now: NOW,
    });
    expect(r.free.map((w) => w.id)).toEqual(['ws-p2', 'ws-p3', 'ws-p4']);
    expect(r.occupied).toHaveLength(1);
    expect(r.occupied[0]?.workstation.name).toBe('Accettazione 1');
    expect(r.occupied[0]?.reason).toBe('in uso da Mario Rossi');
  });

  it("un'occupazione scaduta non conta più", () => {
    const r = workstationAvailability({
      workstations: tutte,
      claims: [claim('ws-p1', 'op-advisor-1', 'Mario Rossi', -1)],
      busyBays: [],
      now: NOW,
    });
    expect(r.free).toHaveLength(4);
  });

  it('un veicolo in carico nella campata occupa la relativa accettazione', () => {
    const r = workstationAvailability({
      workstations: tutte,
      claims: [],
      busyBays: [
        {
          bayId: 'bay-c3',
          code: 'F012',
          operatorId: asOperatorId('op-advisor-2'),
          operatorName: 'Laura Bianchi',
        },
      ],
      now: NOW,
    });
    expect(r.free.map((w) => w.id)).toEqual(['ws-p1', 'ws-p2', 'ws-p4']);
    expect(r.occupied[0]?.reason).toBe('veicolo F012 in carico a Laura Bianchi');
  });

  it('chi rientra ritrova la propria accettazione fra le libere, non quelle degli altri', () => {
    const r = workstationAvailability({
      workstations: tutte,
      claims: [
        claim('ws-p1', 'op-advisor-1', 'Mario Rossi'),
        claim('ws-p2', 'op-advisor-2', 'Laura Bianchi'),
      ],
      busyBays: [
        {
          bayId: 'bay-c3',
          code: 'F020',
          operatorId: asOperatorId('op-advisor-1'),
          operatorName: 'Mario Rossi',
        },
      ],
      now: NOW,
      forOperatorId: asOperatorId('op-advisor-1'),
    });
    // Mario: la sua occupazione (1) e il suo veicolo in carico (3) non lo escludono; Laura sì (2).
    expect(r.free.map((w) => w.id)).toEqual(['ws-p1', 'ws-p3', 'ws-p4']);
    expect(r.occupied.map((o) => o.workstation.id)).toEqual(['ws-p2']);
  });
});
