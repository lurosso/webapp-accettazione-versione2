import { describe, expect, it } from 'vitest';
import { CodeGenerator } from '@/application/queue/CodeGenerator';
import { buildTestEnv, TEST_DATE } from '../helpers/fixtures';

describe('CodeGenerator', () => {
  it('ambito SITE: un solo contatore con prefisso di sede, indipendente dal marchio', async () => {
    const env = buildTestEnv();
    const gen = new CodeGenerator(env.appointments, { sitePrefix: 'F', scope: 'SITE' });
    const [fiat, jeep] = env.seed.brands;
    if (fiat === undefined || jeep === undefined) {
      throw new Error('seed incompleto');
    }
    expect((await gen.next(TEST_DATE, fiat)).code).toBe('F001');
    expect((await gen.next(TEST_DATE, jeep)).code).toBe('F002');
  });

  it('ambito BRAND: un contatore per marchio con il suo prefisso', async () => {
    const env = buildTestEnv();
    const gen = new CodeGenerator(env.appointments, { sitePrefix: 'F', scope: 'BRAND' });
    const [fiat, jeep] = env.seed.brands;
    if (fiat === undefined || jeep === undefined) {
      throw new Error('seed incompleto');
    }
    expect((await gen.next(TEST_DATE, fiat)).code).toBe('F001');
    expect((await gen.next(TEST_DATE, jeep)).code).toBe('J001');
    expect((await gen.next(TEST_DATE, fiat)).code).toBe('F002');
  });
});
