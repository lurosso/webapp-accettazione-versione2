import { describe, expect, it } from 'vitest';
import { hashPassword, isDemoPasswordHash, verifyPassword } from '@/lib/hash-password';

describe('hash-password', () => {
  it('hash scrypt verificabile, con sale casuale', () => {
    const h1 = hashPassword('Segreta123!');
    const h2 = hashPassword('Segreta123!');
    expect(h1).not.toBe(h2);
    expect(h1.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword('Segreta123!', h1)).toBe(true);
    expect(verifyPassword('segreta123!', h1)).toBe(false);
  });

  it('formati corrotti o sconosciuti → false, mai eccezione', () => {
    expect(verifyPassword('x', 'scrypt$N=abc$$')).toBe(false);
    expect(verifyPassword('x', 'bcrypt$...')).toBe(false);
    expect(verifyPassword('x', '')).toBe(false);
  });

  it('il prefisso demo "plain:" è riconosciuto e confrontato a tempo costante', () => {
    expect(isDemoPasswordHash('plain:demo')).toBe(true);
    expect(isDemoPasswordHash(hashPassword('demo'))).toBe(false);
    expect(verifyPassword('demo', 'plain:demo')).toBe(true);
    expect(verifyPassword('demo2', 'plain:demo')).toBe(false);
  });
});
