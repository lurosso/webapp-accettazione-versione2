// Sessioni: una sola valida per operatore. Un nuovo login o un cambio password invalidano il token
// precedente, senza lista di revoca: la rivendicazione del posto porta l'istante dell'ultima
// emissione, e un token con un `iat` diverso non passa più.
import { describe, expect, it } from 'vitest';
import { LocalAuthService } from '@/application/auth/LocalAuthService';
import { buildTestEnv } from '../helpers/fixtures';

const SECRET = 'segreto-di-test-lungo-almeno-trentadue-caratteri';

function setup() {
  const env = buildTestEnv();
  const service = new LocalAuthService({
    operators: env.operators,
    referenceData: env.referenceData,
    claims: env.workstationClaims,
    clock: env.clock,
    logger: env.logger,
    secret: SECRET,
    ttlHours: 8,
  });
  return { env, service };
}

async function entra(service: LocalAuthService, workstationId = 'ws-p2') {
  const r = await service.login({ username: 'mario.rossi', password: 'demo', workstationId });
  if (!r.ok) {
    throw new Error(r.error.message);
  }
  return r.value;
}

describe('Sicurezza sessioni: revoca implicita', () => {
  it('un nuovo login dello stesso operatore invalida il token precedente', async () => {
    const { env, service } = setup();
    const primo = await entra(service);
    expect((await service.verify(primo.token)).ok).toBe(true);

    env.clock.advance(5_000);
    const secondo = await entra(service);
    expect((await service.verify(secondo.token)).ok).toBe(true);

    const vecchio = await service.verify(primo.token);
    expect(vecchio.ok).toBe(false);
    if (!vecchio.ok) {
      expect(vecchio.error.message).toContain('accesso più recente');
    }
  });

  it('il cambio password invalida il token con cui si era entrati', async () => {
    const { env, service } = setup();
    const primo = await entra(service);
    env.clock.advance(5_000);
    const cambiata = await service.changePassword(primo.session, {
      currentPassword: 'demo',
      newPassword: 'nuova-password-lunga-e-diversa',
    });
    expect(cambiata.ok).toBe(true);
    if (!cambiata.ok) {
      return;
    }
    expect((await service.verify(cambiata.value.token)).ok).toBe(true);
    expect((await service.verify(primo.token)).ok).toBe(false);
  });

  it('dopo il logout il token è morto anche se l’operatore rientra sullo stesso sportello', async () => {
    const { env, service } = setup();
    const primo = await entra(service);
    await service.logout(primo.session);
    expect((await service.verify(primo.token)).ok).toBe(false);
    env.clock.advance(5_000);
    const secondo = await entra(service);
    expect((await service.verify(secondo.token)).ok).toBe(true);
    expect((await service.verify(primo.token)).ok).toBe(false);
  });

  it('utente inesistente e password errata rispondono con lo stesso errore', async () => {
    const { service } = setup();
    const inesistente = await service.login({
      username: 'nessuno',
      password: 'qualunque',
      workstationId: 'ws-p2',
    });
    const errata = await service.login({
      username: 'mario.rossi',
      password: 'sbagliata',
      workstationId: 'ws-p2',
    });
    expect(!inesistente.ok && inesistente.error.message).toBe(!errata.ok && errata.error.message);
  });
});
