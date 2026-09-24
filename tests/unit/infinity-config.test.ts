import { describe, expect, it } from 'vitest';
import { parseEnv } from '@/config/env';
import { resolveInfinityRealConfig } from '@/config/infinity';
import { ConfigurationError } from '@/domain/errors';
import { createExternalServices } from '@/services/factory';
import { SequentialIdGenerator } from '@/services/mocks/SequentialIdGenerator';
import { buildTestEnv } from '../helpers/fixtures';

describe('resolveInfinityRealConfig', () => {
  it('con il solo DSN usa i default: SQL Anywhere 12, schema DBA, documenti PR01, credenziali dal DSN', () => {
    const c = resolveInfinityRealConfig('Europe/Rome', { INFINITY_ODBC_DSN: 'Infinity02' });
    expect(c).toEqual({
      dsn: 'Infinity02',
      dbType: 'sql_anywhere_12',
      uid: null,
      pwd: null,
      extra: null,
      schema: 'DBA',
      bookingDocTypes: ['PR01'],
      planningSource: 'auto',
      sede: null,
      timeZone: 'Europe/Rome',
      loginTimeoutSec: 10,
      queryTimeoutSec: 60,
    });
  });

  it("sorgente del planning e sede si leggono dall'ambiente e si validano", () => {
    const c = resolveInfinityRealConfig('Europe/Rome', {
      INFINITY_ODBC_DSN: 'Infinity01',
      INFINITY_PLANNING_SOURCE: 'procedure',
      INFINITY_SEDE: '01',
    });
    expect(c.planningSource).toBe('procedure');
    expect(c.sede).toBe('01');
    expect(() =>
      resolveInfinityRealConfig('Europe/Rome', {
        INFINITY_ODBC_DSN: 'X',
        INFINITY_PLANNING_SOURCE: 'excel',
      }),
    ).toThrow(/INFINITY_PLANNING_SOURCE/);
    expect(() =>
      resolveInfinityRealConfig('Europe/Rome', { INFINITY_ODBC_DSN: 'X', INFINITY_SEDE: 'BARI' }),
    ).toThrow(/INFINITY_SEDE/);
  });

  it("il passaggio a infinity01 è una variabile: DSN, tipi documento e timeout letti dall'ambiente", () => {
    const c = resolveInfinityRealConfig('Europe/Rome', {
      INFINITY_ODBC_DSN: 'Infinity01',
      INFINITY_BOOKING_DOC_TYPES: 'PR01, PR20',
      INFINITY_ODBC_QUERY_TIMEOUT_SEC: '120',
      INFINITY_ODBC_UID: 'app_lettura',
    });
    expect(c.dsn).toBe('Infinity01');
    expect(c.bookingDocTypes).toEqual(['PR01', 'PR20']);
    expect(c.queryTimeoutSec).toBe(120);
    expect(c.uid).toBe('app_lettura');
  });

  it("senza DSN, con motore sconosciuto o schema non valido ferma l'avvio", () => {
    expect(() => resolveInfinityRealConfig('Europe/Rome', {})).toThrow(ConfigurationError);
    expect(() =>
      resolveInfinityRealConfig('Europe/Rome', {
        INFINITY_ODBC_DSN: 'X',
        INFINITY_DB_TYPE: 'postgres',
      }),
    ).toThrow(/INFINITY_DB_TYPE/);
    expect(() =>
      resolveInfinityRealConfig('Europe/Rome', {
        INFINITY_ODBC_DSN: 'X',
        INFINITY_DB_SCHEMA: 'DBA; DROP',
      }),
    ).toThrow(/INFINITY_DB_SCHEMA/);
  });
});

describe('factory: ramo real di Infinity', () => {
  function deps() {
    const env = buildTestEnv();
    return {
      clock: env.clock,
      ids: new SequentialIdGenerator('f'),
      logger: env.logger,
      brands: env.seed.brands,
      desks: env.seed.desks,
    };
  }

  it('con INFINITY_PROVIDER=real e DSN presente costruisce la porta reale senza aprire connessioni', () => {
    const precedente = process.env['INFINITY_ODBC_DSN'];
    process.env['INFINITY_ODBC_DSN'] = 'Infinity02';
    try {
      // Nessuna connessione alla costruzione (il modulo nativo si carica alla prima query):
      // il test non tocca il database e gira anche dove il DSN non esiste.
      const services = createExternalServices(
        parseEnv({ INFINITY_PROVIDER: 'real' }, () => undefined),
        deps(),
      );
      expect(services.infinity.name).toBe('INFINITY');
    } finally {
      if (precedente === undefined) {
        delete process.env['INFINITY_ODBC_DSN'];
      } else {
        process.env['INFINITY_ODBC_DSN'] = precedente;
      }
    }
  });

  it('con INFINITY_PROVIDER=real senza DSN fallisce subito con ConfigurationError', () => {
    const precedente = process.env['INFINITY_ODBC_DSN'];
    delete process.env['INFINITY_ODBC_DSN'];
    try {
      expect(() =>
        createExternalServices(
          parseEnv({ INFINITY_PROVIDER: 'real' }, () => undefined),
          deps(),
        ),
      ).toThrow(ConfigurationError);
    } finally {
      if (precedente !== undefined) {
        process.env['INFINITY_ODBC_DSN'] = precedente;
      }
    }
  });
});
