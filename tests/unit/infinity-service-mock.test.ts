import { describe, expect, it } from 'vitest';
import type { InfinityMockMode } from '@/services/interfaces/mock-config';
import { InfinityServiceMock } from '@/services/mocks/InfinityServiceMock';
import { buildTestEnv, TEST_DATE } from '../helpers/fixtures';

function buildMock(mode: InfinityMockMode = 'ok', seed = 'test-seed') {
  const env = buildTestEnv();
  return new InfinityServiceMock(
    {
      seed,
      mode,
      latencyMs: 0,
      flakyFailures: 1,
      cancelOnSecondCall: false,
      brands: env.seed.brands,
      desks: env.seed.desks,
    },
    { clock: env.clock, logger: env.logger },
  );
}

describe('InfinityServiceMock', () => {
  it('con lo stesso seed produce la stessa agenda, realistica e ordinabile', async () => {
    const a = await buildMock().fetchDailyAgenda(TEST_DATE);
    const b = await buildMock().fetchDailyAgenda(TEST_DATE);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.appointments.length).toBeGreaterThan(10);
      expect(a.value.appointments).toEqual(b.value.appointments);
      expect(a.value.businessDate).toBe(TEST_DATE);
      for (const dto of a.value.appointments) {
        expect(dto.plate).toMatch(/^[A-Z]{2}\d{3}[A-Z]{2}$/);
        expect(dto.scheduledAt.startsWith(TEST_DATE)).toBe(true);
      }
    }
  });

  it('seed diversi producono agende diverse', async () => {
    const a = await buildMock('ok', 'seed-1').fetchDailyAgenda(TEST_DATE);
    const b = await buildMock('ok', 'seed-2').fetchDailyAgenda(TEST_DATE);
    if (a.ok && b.ok) {
      expect(a.value.appointments).not.toEqual(b.value.appointments);
    } else {
      throw new Error('atteso ok');
    }
  });

  it('in modalità error restituisce un ProviderError come valore', async () => {
    const r = await buildMock('error').fetchDailyAgenda(TEST_DATE);
    expect(r.ok).toBe(false);
  });

  it("in modalità empty restituisce un'agenda vuota", async () => {
    const r = await buildMock('empty').fetchDailyAgenda(TEST_DATE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.appointments).toHaveLength(0);
    }
  });
});
