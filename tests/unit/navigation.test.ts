import { describe, expect, it } from 'vitest';
import {
  canAccess,
  homePathForRole,
  safeInternalPath,
  CHECK_IN_PARAM,
  checkInPath,
} from '@/lib/navigation';

describe('homePathForRole', () => {
  it('ogni ruolo ha la propria area: nessuno viene mandato in accettazione per forza', () => {
    expect(homePathForRole('ADVISOR')).toBe('/accettazione');
    expect(homePathForRole('SUPERVISOR')).toBe('/manager');
    expect(homePathForRole('ADMIN')).toBe('/admin');
  });
});

describe('canAccess', () => {
  it("l'accettatore entra solo in accettazione e sistema", () => {
    expect(canAccess('accettazione', 'ADVISOR')).toBe(true);
    expect(canAccess('sistema', 'ADVISOR')).toBe(true);
    expect(canAccess('manager', 'ADVISOR')).toBe(false);
    expect(canAccess('admin', 'ADVISOR')).toBe(false);
  });

  it('il responsabile entra nella sua area ma non in amministrazione', () => {
    expect(canAccess('manager', 'SUPERVISOR')).toBe(true);
    expect(canAccess('admin', 'SUPERVISOR')).toBe(false);
  });

  it("l'amministratore entra ovunque", () => {
    for (const area of ['accettazione', 'manager', 'admin', 'sistema'] as const) {
      expect(canAccess(area, 'ADMIN')).toBe(true);
    }
  });
});

describe('safeInternalPath', () => {
  it('accetta solo percorsi interni', () => {
    expect(safeInternalPath('/manager', '/')).toBe('/manager');
    expect(safeInternalPath(['/admin'], '/')).toBe('/admin');
  });

  it('rifiuta URL esterni e valori assenti', () => {
    expect(safeInternalPath('//evil.example.com', '/')).toBe('/');
    expect(safeInternalPath('https://evil.example.com', '/')).toBe('/');
    expect(safeInternalPath(undefined, '/accettazione')).toBe('/accettazione');
  });
});

describe('checkInPath', () => {
  it("porta all'ispezione della pratica indicata", () => {
    expect(checkInPath('app-1')).toBe('/tablet?pratica=app-1');
    expect(checkInPath('app-1')).toContain(`${CHECK_IN_PARAM}=`);
  });

  it('codifica gli identificativi con caratteri speciali', () => {
    expect(checkInPath('app/1 2')).toBe('/tablet?pratica=app%2F1%202');
  });
});
