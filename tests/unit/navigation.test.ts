import { describe, expect, it } from 'vitest';
import {
  canAccess,
  destinationAfterPasswordChange,
  homePathForRole,
  safeInternalPath,
  CHECK_IN_PARAM,
  checkInPath,
} from '@/lib/navigation';

describe('homePathForRole', () => {
  it('ogni ruolo ha la propria area: nessuno viene mandato in accettazione per forza', () => {
    expect(homePathForRole('ADVISOR')).toBe('/accettazione');
    expect(homePathForRole('ADMIN')).toBe('/admin');
  });
});

describe('canAccess', () => {
  it("l'accettatore entra solo in accettazione e sistema", () => {
    expect(canAccess('accettazione', 'ADVISOR')).toBe(true);
    expect(canAccess('check-in', 'ADVISOR')).toBe(true);
    expect(canAccess('sistema', 'ADVISOR')).toBe(true);
    expect(canAccess('admin', 'ADVISOR')).toBe(false);
  });

  it("l'amministratore entra ovunque", () => {
    for (const area of ['accettazione', 'admin', 'sistema'] as const) {
      expect(canAccess(area, 'ADMIN')).toBe(true);
    }
  });
});

describe('safeInternalPath', () => {
  it('accetta solo percorsi interni', () => {
    expect(safeInternalPath('/sistema', '/')).toBe('/sistema');
    expect(safeInternalPath(['/admin'], '/')).toBe('/admin');
  });

  it('rifiuta URL esterni e valori assenti', () => {
    expect(safeInternalPath('//evil.example.com', '/')).toBe('/');
    expect(safeInternalPath('https://evil.example.com', '/')).toBe('/');
    // Per il parser degli URL `/\evil.example.com` è `//evil.example.com`: open redirect dopo il login.
    expect(safeInternalPath('/\\evil.example.com', '/')).toBe('/');
    expect(safeInternalPath('/\\/evil.example.com', '/')).toBe('/');
    // La forma ancora codificata resta un percorso interno (il browser la chiede al nostro server).
    expect(safeInternalPath('/%5Cevil.example.com', '/')).toBe('/%5Cevil.example.com');
    expect(safeInternalPath(undefined, '/accettazione')).toBe('/accettazione');
  });
});

describe('checkInPath', () => {
  it("porta all'ispezione della pratica indicata", () => {
    expect(checkInPath('app-1')).toBe('/check-in?pratica=app-1');
    expect(checkInPath('app-1')).toContain(`${CHECK_IN_PARAM}=`);
  });

  it('codifica gli identificativi con caratteri speciali', () => {
    expect(checkInPath('app/1 2')).toBe('/check-in?pratica=app%2F1%202');
  });
});

describe('destinationAfterPasswordChange', () => {
  it('torna alla pagina che si stava aprendo', () => {
    expect(destinationAfterPasswordChange('/accettazione?view=global', 'ADVISOR')).toBe(
      '/accettazione?view=global',
    );
    expect(destinationAfterPasswordChange(['/sistema'], 'ADVISOR')).toBe('/sistema');
  });

  it('senza destinazione va alla home del ruolo, mai restando sul cambio password o sul login', () => {
    expect(destinationAfterPasswordChange(undefined, 'ADVISOR')).toBe('/accettazione');
    expect(destinationAfterPasswordChange('/', 'ADMIN')).toBe('/admin');
    expect(destinationAfterPasswordChange('/cambia-password', 'ADVISOR')).toBe('/accettazione');
    expect(destinationAfterPasswordChange('/cambia-password?next=%2Fadmin', 'ADMIN')).toBe(
      '/admin',
    );
    expect(destinationAfterPasswordChange('/login', 'ADVISOR')).toBe('/accettazione');
  });

  it('rifiuta destinazioni esterne', () => {
    expect(destinationAfterPasswordChange('//evil.example.com', 'ADVISOR')).toBe('/accettazione');
    expect(destinationAfterPasswordChange('https://evil.example.com', 'ADMIN')).toBe('/admin');
  });
});
