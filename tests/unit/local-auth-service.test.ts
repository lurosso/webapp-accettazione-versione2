import { describe, expect, it } from 'vitest';
import { LocalAuthService } from '@/application/auth/LocalAuthService';
import { verifySessionToken } from '@/application/auth/session-token';
import { buildTestEnv } from '../helpers/fixtures';

const SECRET = 'segreto-di-test-lungo-almeno-trentadue-caratteri';

function setup() {
  const env = buildTestEnv();
  const service = new LocalAuthService({
    operators: env.operators,
    referenceData: env.referenceData,
    clock: env.clock,
    logger: env.logger,
    secret: SECRET,
    ttlHours: 8,
  });
  return { env, service };
}

describe('LocalAuthService', () => {
  it('login corretto emette una sessione di 8 ore con postazione e ruolo', async () => {
    const { service } = setup();
    const r = await service.login({
      username: 'Mario.Rossi',
      password: 'demo',
      workstationId: 'ws-p2',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.session.role).toBe('ADVISOR');
      expect(r.value.session.workstationId).toBe('ws-p2');
      expect(
        new Date(r.value.session.expiresAt).getTime() -
          new Date(r.value.session.issuedAt).getTime(),
      ).toBe(8 * 3_600_000);
      const verified = await service.verify(r.value.token);
      expect(verified.ok && verified.value.operatorId === r.value.session.operatorId).toBe(true);
    }
  });

  it('password errata, utente sconosciuto e postazione inesistente → errori generici', async () => {
    const { service } = setup();
    const wrong = await service.login({
      username: 'admin',
      password: 'sbagliata',
      workstationId: 'ws-p1',
    });
    const unknown = await service.login({
      username: 'nessuno',
      password: 'demo',
      workstationId: 'ws-p1',
    });
    expect(wrong.ok).toBe(false);
    expect(unknown.ok).toBe(false);
    if (!wrong.ok && !unknown.ok) {
      expect(wrong.error.message).toBe(unknown.error.message);
    }
    const badWs = await service.login({
      username: 'admin',
      password: 'demo',
      workstationId: 'ws-x',
    });
    expect(badWs.ok).toBe(false);
  });

  it('token manomesso o firmato con altro segreto → VALIDATION', async () => {
    const { service } = setup();
    const r = await service.login({ username: 'admin', password: 'demo', workstationId: 'ws-p1' });
    if (!r.ok) {
      throw new Error('login atteso ok');
    }
    const tampered = `${r.value.token.slice(0, -2)}xx`;
    expect((await service.verify(tampered)).ok).toBe(false);
    const other = await verifySessionToken(
      r.value.token,
      'un-altro-segreto-lungo-almeno-trentadue-car',
    );
    expect(other.ok).toBe(false);
    if (!other.ok) {
      expect(other.error.code).toBe('VALIDATION');
    }
  });

  it("token scaduto secondo l'IClock iniettato → non valido", async () => {
    const { env, service } = setup();
    const r = await service.login({ username: 'admin', password: 'demo', workstationId: 'ws-p1' });
    if (!r.ok) {
      throw new Error('login atteso ok');
    }
    env.clock.advance(7 * 3_600_000);
    expect((await service.verify(r.value.token)).ok).toBe(true);
    env.clock.advance(2 * 3_600_000);
    const expired = await service.verify(r.value.token);
    expect(expired.ok).toBe(false);
    if (!expired.ok) {
      expect(expired.error.code).toBe('VALIDATION');
    }
  });
});
