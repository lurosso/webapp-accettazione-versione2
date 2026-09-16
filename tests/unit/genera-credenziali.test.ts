import { describe, expect, it } from 'vitest';
import { decodeAdminPasswordHash } from '@/config/seed';
import { verifyPassword } from '@/lib/hash-password';
import {
  codificaHashPerEnv,
  generaPasswordProvvisoria,
  generaSegreto,
  hashScrypt,
} from '../../scripts/genera-credenziali.mjs';

describe('scripts/genera-credenziali.mjs', () => {
  it("produce hash scrypt che l'applicazione verifica, anche dopo la codifica base64 per .env", () => {
    const password = generaPasswordProvvisoria();
    expect(password).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    const hash = hashScrypt(password);
    expect(hash.startsWith('scrypt$N=16384,r=8,p=1$')).toBe(true);
    expect(verifyPassword(password, hash)).toBe(true);
    expect(verifyPassword(`${password}x`, hash)).toBe(false);
    const perEnv = codificaHashPerEnv(hash);
    expect(perEnv.startsWith('base64:')).toBe(true);
    expect(perEnv.includes('$')).toBe(false);
    expect(decodeAdminPasswordHash(perEnv)).toBe(hash);
  });

  it('genera segreti esadecimali della lunghezza richiesta e diversi fra loro', () => {
    expect(generaSegreto()).toMatch(/^[0-9a-f]{64}$/);
    expect(generaSegreto(24)).toMatch(/^[0-9a-f]{48}$/);
    expect(generaSegreto()).not.toBe(generaSegreto());
  });
});
