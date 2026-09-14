import { describe, expect, it } from 'vitest';
import {
  ALLOWED_TRANSITIONS,
  assertTransition,
  canTransition,
} from '@/domain/appointment-state-machine';
import { APPOINTMENT_STATUSES, type AppointmentStatus } from '@/domain/entities/appointment';

describe('appointment-state-machine', () => {
  it('ammette le transizioni dei requisiti', () => {
    expect(canTransition('WAITING', 'IN_PROGRESS')).toBe(true);
    expect(canTransition('WAITING', 'SKIPPED')).toBe(true);
    expect(canTransition('SKIPPED', 'IN_PROGRESS')).toBe(true);
    expect(canTransition('SKIPPED', 'WAITING')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'COMPLETED')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'WAITING')).toBe(true);
    expect(canTransition('NO_SHOW', 'WAITING')).toBe(true);
  });

  it('CANCELLED è terminale; COMPLETED si riapre solo in carico', () => {
    for (const to of APPOINTMENT_STATUSES) {
      expect(canTransition('CANCELLED', to)).toBe(false);
      expect(canTransition('COMPLETED', to)).toBe(to === 'IN_PROGRESS');
    }
  });

  it('vieta le transizioni non elencate', () => {
    expect(canTransition('WAITING', 'COMPLETED')).toBe(false);
    expect(canTransition('IN_PROGRESS', 'SKIPPED')).toBe(false);
    expect(canTransition('IN_PROGRESS', 'NO_SHOW')).toBe(false);
  });

  it('assertTransition restituisce INVALID_TRANSITION come valore, mai eccezione', () => {
    const result = assertTransition('WAITING', 'COMPLETED');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_TRANSITION');
      expect(result.error.details?.['allowed']).toEqual(ALLOWED_TRANSITIONS.WAITING);
    }
    expect(assertTransition('WAITING', 'IN_PROGRESS').ok).toBe(true);
  });

  it('la tabella copre tutti gli stati', () => {
    const covered = Object.keys(ALLOWED_TRANSITIONS) as AppointmentStatus[];
    expect(covered.sort()).toEqual([...APPOINTMENT_STATUSES].sort());
  });
});
