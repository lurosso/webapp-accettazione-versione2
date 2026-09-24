// Chi vede cosa, dopo il 2026-09-24: il BDC non usa più l'app (gli assenti gli arrivano come lead
// nel CRM) e il ruolo Responsabile/BDC non esiste. Restano l'accettatore, che governa la coda al
// banco e sul piazzale, l'amministratore, che vede tutto perché deve poter controllare, e il kiosk,
// che è un dispositivo e non ha un'area operatore.
//
// La regola vive in un posto solo (`AREA_ROLES`): pagine, navigazione e rotte API la leggono da lì.
import { describe, expect, it } from 'vitest';
import { OPERATOR_ROLES, type OperatorRole } from '@/domain/entities/operator';
import {
  AREA_ROLES,
  canAccess,
  homePathForRole,
  redirectForForbiddenArea,
  type ProtectedArea,
} from '@/lib/navigation';

const AREE: readonly ProtectedArea[] = [
  'accettazione',
  'check-in',
  'admin',
  'sistema',
  'comunicazioni',
];

describe('RBAC: accettatore, amministratore, kiosk', () => {
  it('i ruoli sono tre: il Responsabile/BDC non esiste più', () => {
    expect(OPERATOR_ROLES).toEqual(['ADVISOR', 'ADMIN', 'KIOSK']);
    expect(Object.keys(AREA_ROLES).sort()).toEqual([...AREE].sort());
  });

  it("l'accettatore lavora su coda, check-in, sistema (ticket) e comunicazioni, non in amministrazione", () => {
    expect(AREE.filter((area) => canAccess(area, 'ADVISOR'))).toEqual([
      'accettazione',
      'check-in',
      'sistema',
      'comunicazioni',
    ]);
    expect(redirectForForbiddenArea('admin', 'ADVISOR')).toBe('/accettazione');
  });

  it("l'amministratore vede tutto: è l'unico che deve poter controllare", () => {
    for (const area of AREE) {
      expect(canAccess(area, 'ADMIN')).toBe(true);
      expect(redirectForForbiddenArea(area, 'ADMIN')).toBeNull();
    }
  });

  it('un kiosk non entra in nessuna area e non viene rimbalzato da nessuna parte', () => {
    for (const area of AREE) {
      expect(canAccess(area, 'KIOSK')).toBe(false);
      expect(redirectForForbiddenArea(area, 'KIOSK')).toBeNull();
    }
    expect(homePathForRole('KIOSK')).toBe('/display/sala-attesa');
  });

  it('ogni ruolo operativo ha una casa coerente con i propri permessi', () => {
    const casa: Record<Exclude<OperatorRole, 'KIOSK'>, ProtectedArea> = {
      ADVISOR: 'accettazione',
      ADMIN: 'admin',
    };
    expect(homePathForRole('ADVISOR')).toBe('/accettazione');
    expect(homePathForRole('ADMIN')).toBe('/admin');
    for (const [role, area] of Object.entries(casa) as [OperatorRole, ProtectedArea][]) {
      expect(canAccess(area, role)).toBe(true);
    }
  });

  it('nessuna area resta senza ruoli: una porta murata sarebbe un bug silenzioso', () => {
    for (const area of AREE) {
      expect(AREA_ROLES[area].length).toBeGreaterThan(0);
    }
  });
});
