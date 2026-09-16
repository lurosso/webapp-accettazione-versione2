import { describe, expect, it } from 'vitest';
import { createContainer } from '@/config/container';
import { parseEnv } from '@/config/env';
import {
  buildSeedData,
  decodeAdminPasswordHash,
  displayTokenFor,
  hasDemoCredentials,
  SEED_DISPLAY_TOKEN_SECRET_MIN_LENGTH,
  type SeedOptions,
} from '@/config/seed';
import { FALLBACK_BRAND_CODE } from '@/domain/entities/brand';
import { ConfigurationError } from '@/domain/errors';
import { hashPassword, verifyPassword } from '@/lib/hash-password';
import { InMemoryStore } from '@/repositories/in-memory/InMemoryStore';
import { NoopLogger } from '@/services/mocks/ConsoleLogger';

const PASSWORD = 'Prova-2026-ABCD';
const SEGRETO = 'segreto-dei-display-di-prova-2026';

function realOptions(overrides: Partial<SeedOptions> = {}): SeedOptions {
  return {
    seedProfile: 'real',
    seedAdminPasswordHash: hashPassword(PASSWORD),
    seedDisplayTokenSecret: SEGRETO,
    ...overrides,
  };
}

describe('Seed: profilo demo (predefinito)', () => {
  it('resta quello di sempre e viene riconosciuto come demo', () => {
    const seed = buildSeedData();
    expect(hasDemoCredentials(seed)).toBe(true);
    expect(seed.brands).toHaveLength(7);
    expect(seed.desks).toHaveLength(3);
    expect(seed.operators.map((o) => o.username)).toContain('mario.rossi');
    expect(seed.brands.some((b) => b.code === FALLBACK_BRAND_CODE)).toBe(false);
  });
});

describe('Seed: profilo real (officina di Bari, senza credenziali demo)', () => {
  it('ha un solo amministratore con hash scrypt e password da cambiare al primo accesso', () => {
    const seed = buildSeedData(realOptions());
    expect(hasDemoCredentials(seed)).toBe(false);
    expect(seed.operators).toHaveLength(1);
    const [admin] = seed.operators;
    expect(admin?.username).toBe('admin');
    expect(admin?.role).toBe('ADMIN');
    expect(admin?.mustChangePassword).toBe(true);
    expect(admin?.deskIds).toEqual(seed.desks.map((d) => d.id));
    expect(verifyPassword(PASSWORD, admin?.passwordHash ?? '')).toBe(true);
    expect(verifyPassword('demo', admin?.passwordHash ?? '')).toBe(false);
  });

  it("accetta l'hash anche nella forma base64 stampata dallo script", () => {
    const hash = hashPassword(PASSWORD);
    const base64 = `base64:${Buffer.from(hash, 'utf8').toString('base64')}`;
    expect(decodeAdminPasswordHash(base64)).toBe(hash);
    expect(decodeAdminPasswordHash(hash)).toBe(hash);
    expect(decodeAdminPasswordHash('plain:demo')).toBeNull();
    expect(
      decodeAdminPasswordHash(`base64:${Buffer.from('plain:demo').toString('base64')}`),
    ).toBeNull();
    const seed = buildSeedData(realOptions({ seedAdminPasswordHash: base64 }));
    expect(verifyPassword(PASSWORD, seed.operators[0]?.passwordHash ?? '')).toBe(true);
  });

  it('porta i marchi del planning di Bari, «Altri marchi» servito da entrambi gli sportelli e ogni marchio su uno sportello', () => {
    const seed = buildSeedData(realOptions());
    const codici = seed.brands.map((b) => b.code);
    for (const atteso of [
      'FIAT',
      'LANCIA',
      'ALFA_ROMEO',
      'JEEP',
      'EMC',
      'LEAPMOTOR',
      'PEUGEOT',
      'CITROEN',
      'DS',
      'OPEL',
      'XEV',
      FALLBACK_BRAND_CODE,
    ]) {
      expect(codici).toContain(atteso);
    }
    expect(seed.desks).toHaveLength(2);
    const altro = seed.brands.find((b) => b.code === FALLBACK_BRAND_CODE)!;
    expect(seed.desks.every((d) => d.brandIds.includes(altro.id))).toBe(true);
    for (const b of seed.brands) {
      expect(seed.desks.some((d) => d.brandIds.includes(b.id))).toBe(true);
    }
    // Prefissi dei codici (CODE_SEQUENCE_SCOPE=BRAND) tutti diversi.
    expect(new Set(seed.brands.map((b) => b.codePrefix)).size).toBe(seed.brands.length);
    // Postazioni e campate coerenti: ogni postazione punta a uno sportello e a una campata esistenti.
    for (const w of seed.workstations) {
      expect(seed.desks.some((d) => d.id === w.deskId)).toBe(true);
      expect(seed.bays.some((b) => b.id === w.defaultBayId)).toBe(true);
    }
  });

  it('i token dei display derivano dal segreto: stabili, distinti, non prevedibili', () => {
    const seed = buildSeedData(realOptions());
    const token = seed.bays.map((b) => b.displayToken);
    expect(token).toHaveLength(4);
    expect(new Set(token).size).toBe(4);
    for (const t of token) {
      expect(t).toMatch(/^[0-9a-f]{32}$/);
    }
    expect(seed.bays[0]?.displayToken).toBe(displayTokenFor(SEGRETO, 'C1'));
    const altroSegreto = buildSeedData(realOptions({ seedDisplayTokenSecret: `${SEGRETO}-altro` }));
    expect(altroSegreto.bays[0]?.displayToken).not.toBe(seed.bays[0]?.displayToken);
  });

  it("senza hash valido o con segreto troppo corto ferma l'avvio con un messaggio che rimanda allo script", () => {
    expect(() => buildSeedData(realOptions({ seedAdminPasswordHash: null }))).toThrow(
      ConfigurationError,
    );
    expect(() => buildSeedData(realOptions({ seedAdminPasswordHash: 'plain:demo' }))).toThrow(
      /seed:credenziali/,
    );
    expect(() =>
      buildSeedData(
        realOptions({
          seedDisplayTokenSecret: 'x'.repeat(SEED_DISPLAY_TOKEN_SECRET_MIN_LENGTH - 1),
        }),
      ),
    ).toThrow(/SEED_DISPLAY_TOKEN_SECRET/);
  });
});

describe('Seed: ambiente e container', () => {
  it("parseEnv legge SEED_PROFILE, l'hash e il segreto; un profilo ignoto ricade su demo", () => {
    const avvisi: string[] = [];
    const env = parseEnv(
      {
        SEED_PROFILE: 'real',
        SEED_ADMIN_PASSWORD_HASH: 'base64:abc',
        SEED_DISPLAY_TOKEN_SECRET: ' segreto ',
      },
      (m) => avvisi.push(m),
    );
    expect(env.seedProfile).toBe('real');
    expect(env.seedAdminPasswordHash).toBe('base64:abc');
    expect(env.seedDisplayTokenSecret).toBe('segreto');
    expect(parseEnv({}, () => undefined).seedProfile).toBe('demo');
    expect(parseEnv({ SEED_PROFILE: 'boh' }, (m) => avvisi.push(m)).seedProfile).toBe('demo');
    expect(avvisi.some((m) => m.includes('SEED_PROFILE'))).toBe(true);
  });

  it('con un provider reale il container rifiuta il seed demo e accetta quello real', () => {
    expect(() =>
      createContainer({
        env: { infinityProvider: 'real' },
        store: InMemoryStore.createIsolated(),
        logger: new NoopLogger(),
        sessionSecret: 's'.repeat(40),
      }),
    ).toThrow(/credenziali demo/);
    // Con il profilo real il guard passa: se qualcosa fallisce dopo (DSN assente), non è il seed.
    expect(() =>
      createContainer({
        env: {
          infinityProvider: 'real',
          seedProfile: 'real',
          seedAdminPasswordHash: hashPassword(PASSWORD),
          seedDisplayTokenSecret: SEGRETO,
        },
        store: InMemoryStore.createIsolated(),
        logger: new NoopLogger(),
        sessionSecret: 's'.repeat(40),
      }),
    ).not.toThrow(/credenziali demo/);
  });
});
