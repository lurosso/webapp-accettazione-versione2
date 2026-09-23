// Recinto del BDC: chi vede cosa, e dove finisce chi bussa alla porta sbagliata.
//
// La regola vive in un posto solo (`AREA_ROLES`): pagine, navigazione e rotte API la leggono da
// lì. Questi casi la fissano, perché è una regola di responsabilità, non un dettaglio di UI: la
// coda la governano gli accettatori al banco, e una pratica presa in carico da chi sta al telefono
// è una pratica che nessuno sta accettando.
import { describe, expect, it } from 'vitest';
import type { OperatorRole } from '@/domain/entities/operator';
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
  'manager',
  'admin',
  'sistema',
  'comunicazioni',
];

describe('RBAC: il BDC resta sul proprio cruscotto', () => {
  it('il responsabile/BDC (SUPERVISOR) accede solo alla propria area e alle Comunicazioni', () => {
    const consentite = AREE.filter((area) => canAccess(area, 'SUPERVISOR'));
    expect(consentite).toEqual(['manager', 'comunicazioni']);
  });

  it('le Comunicazioni da richiamare sono di banco, BDC e amministratore; non del kiosk', () => {
    expect(canAccess('comunicazioni', 'ADVISOR')).toBe(true);
    expect(canAccess('comunicazioni', 'SUPERVISOR')).toBe(true);
    expect(canAccess('comunicazioni', 'ADMIN')).toBe(true);
    expect(canAccess('comunicazioni', 'KIOSK')).toBe(false);
    expect(redirectForForbiddenArea('comunicazioni', 'SUPERVISOR')).toBeNull();
  });

  it('coda, archivio, check-in e sistema sono del banco e dell’amministratore', () => {
    for (const area of ['accettazione', 'check-in', 'sistema'] as const) {
      expect(canAccess(area, 'ADVISOR')).toBe(true);
      expect(canAccess(area, 'ADMIN')).toBe(true);
      expect(canAccess(area, 'SUPERVISOR')).toBe(false);
      expect(canAccess(area, 'KIOSK')).toBe(false);
    }
  });

  it('il BDC che apre la coda viene rimandato al suo cruscotto, non a una pagina di errore', () => {
    expect(redirectForForbiddenArea('accettazione', 'SUPERVISOR')).toBe('/manager');
    expect(redirectForForbiddenArea('check-in', 'SUPERVISOR')).toBe('/manager');
    expect(redirectForForbiddenArea('sistema', 'SUPERVISOR')).toBe('/manager');
    expect(redirectForForbiddenArea('admin', 'SUPERVISOR')).toBe('/manager');
    // Dove può stare, nessun rimbalzo.
    expect(redirectForForbiddenArea('manager', 'SUPERVISOR')).toBeNull();
    // Un kiosk non ha un'area operatore: non lo si manda da nessuna parte.
    expect(redirectForForbiddenArea('accettazione', 'KIOSK')).toBeNull();
  });

  it("l'accettatore non entra nell'area del BDC né in amministrazione", () => {
    expect(canAccess('manager', 'ADVISOR')).toBe(false);
    expect(canAccess('admin', 'ADVISOR')).toBe(false);
    expect(redirectForForbiddenArea('manager', 'ADVISOR')).toBe('/accettazione');
  });

  it("l'amministratore vede tutto: è l'unico che deve poter controllare", () => {
    for (const area of AREE) {
      expect(canAccess(area, 'ADMIN')).toBe(true);
      expect(redirectForForbiddenArea(area, 'ADMIN')).toBeNull();
    }
  });

  it('ogni ruolo ha una casa coerente con i propri permessi', () => {
    const ruoli: readonly OperatorRole[] = ['ADVISOR', 'SUPERVISOR', 'ADMIN'];
    for (const role of ruoli) {
      const casa = homePathForRole(role);
      const area: ProtectedArea =
        casa === '/accettazione' ? 'accettazione' : casa === '/manager' ? 'manager' : 'admin';
      expect(canAccess(area, role)).toBe(true);
    }
    expect(homePathForRole('KIOSK')).toBe('/display/sala-attesa');
  });

  it('nessuna area resta senza ruoli: una porta murata sarebbe un bug silenzioso', () => {
    for (const area of AREE) {
      expect(AREA_ROLES[area].length).toBeGreaterThan(0);
    }
  });
});
