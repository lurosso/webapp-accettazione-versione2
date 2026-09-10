import { describe, expect, it } from 'vitest';
import { DEV_SESSION_SECRET, resolveSessionSecret, type SessionSecretEnv } from '@/config/auth';
import { ConfigurationError } from '@/domain/errors';

const ALL_MOCK: SessionSecretEnv = {
  nodeEnv: 'development',
  servicesProvider: 'mock',
  infinityProvider: 'mock',
  spokiProvider: 'mock',
  smsProvider: 'mock',
  crmProvider: 'mock',
  repositoryProvider: 'memory',
};

describe('resolveSessionSecret', () => {
  it('senza SESSION_SECRET in modalità tutta-mock usa il segreto di sviluppo', () => {
    expect(resolveSessionSecret(ALL_MOCK, {})).toBe(DEV_SESSION_SECRET);
  });

  it('senza SESSION_SECRET in produzione o con un provider reale → ConfigurationError', () => {
    expect(() => resolveSessionSecret({ ...ALL_MOCK, nodeEnv: 'production' }, {})).toThrow(
      ConfigurationError,
    );
    expect(() => resolveSessionSecret({ ...ALL_MOCK, infinityProvider: 'real' }, {})).toThrow(
      ConfigurationError,
    );
  });

  it('segreto troppo corto o uguale al default fuori dal mock → ConfigurationError', () => {
    expect(() => resolveSessionSecret(ALL_MOCK, { SESSION_SECRET: 'corto' })).toThrow(
      ConfigurationError,
    );
    expect(() =>
      resolveSessionSecret(
        { ...ALL_MOCK, nodeEnv: 'production' },
        { SESSION_SECRET: DEV_SESSION_SECRET },
      ),
    ).toThrow(ConfigurationError);
  });

  it("un segreto valido viene restituito così com'è (trim incluso)", () => {
    const secret = 'a'.repeat(40);
    expect(
      resolveSessionSecret(
        { ...ALL_MOCK, nodeEnv: 'production' },
        { SESSION_SECRET: ` ${secret} ` },
      ),
    ).toBe(secret);
  });
});
