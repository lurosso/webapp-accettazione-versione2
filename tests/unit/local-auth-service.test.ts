import { describe, expect, it } from 'vitest';
import { OperatorAdminService } from '@/application/admin/OperatorAdminService';
import { LocalAuthService } from '@/application/auth/LocalAuthService';
import { verifySessionToken } from '@/application/auth/session-token';
import { asOperatorId } from '@/domain/ids';
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

describe('LocalAuthService: password provvisoria e cambio password', () => {
  const AMMINISTRATORE = { operatorId: asOperatorId('op-admin') };

  function setupConAdmin() {
    const base = setup();
    const admin = new OperatorAdminService({
      operators: base.env.operators,
      referenceData: base.env.referenceData,
      ids: base.env.ids,
      logger: base.env.logger,
    });
    return { ...base, admin };
  }

  it('gli account del seed non hanno obbligo di cambio: la sessione lo dice', async () => {
    const { env, service } = setup();
    const r = await service.login({ username: 'admin', password: 'demo', workstationId: 'ws-p1' });
    expect(r.ok && r.value.session.mustChangePassword).toBe(false);
    if (r.ok) {
      const claims = await verifySessionToken(r.value.token, SECRET, env.clock.now());
      expect(claims.ok && claims.value.mustChangePassword).toBe(false);
    }
  });

  it("dopo un reset il login riesce ma la sessione porta l'obbligo di cambio, anche nel token", async () => {
    const { env, service, admin } = setupConAdmin();
    const reset = await admin.resetPassword(asOperatorId('op-advisor-1'), AMMINISTRATORE);
    expect(reset.ok).toBe(true);
    if (!reset.ok) {
      return;
    }
    const r = await service.login({
      username: 'mario.rossi',
      password: reset.value.temporaryPassword,
      workstationId: 'ws-p2',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.value.session.mustChangePassword).toBe(true);
    // Il proxy legge il claim senza container: deve esserci.
    const claims = await verifySessionToken(r.value.token, SECRET, env.clock.now());
    expect(claims.ok && claims.value.mustChangePassword).toBe(true);
    // E la riverifica completa lo conferma dal repository.
    const verified = await service.verify(r.value.token);
    expect(verified.ok && verified.value.mustChangePassword).toBe(true);
  });

  it("un reset fatto mentre l'operatore è collegato vale subito alla riverifica", async () => {
    const { env, service, admin } = setupConAdmin();
    const prima = await service.login({
      username: 'mario.rossi',
      password: 'demo',
      workstationId: 'ws-p2',
    });
    expect(prima.ok).toBe(true);
    if (!prima.ok) {
      return;
    }
    await admin.resetPassword(asOperatorId('op-advisor-1'), AMMINISTRATORE);
    // Il token vecchio dice ancora "nessun obbligo"...
    const claims = await verifySessionToken(prima.value.token, SECRET, env.clock.now());
    expect(claims.ok && claims.value.mustChangePassword).toBe(false);
    // ...ma il server, che rilegge l'operatore, lo impone.
    const verified = await service.verify(prima.value.token);
    expect(verified.ok && verified.value.mustChangePassword).toBe(true);
  });

  it('il cambio rifiuta password attuale errata, nuova troppo corta o uguale alla attuale', async () => {
    const { service } = setup();
    const r = await service.login({ username: 'admin', password: 'demo', workstationId: 'ws-p1' });
    if (!r.ok) {
      throw new Error('login fallito');
    }
    const sbagliata = await service.changePassword(r.value.session, {
      currentPassword: 'non-demo',
      newPassword: 'nuova-password-lunga',
    });
    expect(!sbagliata.ok && sbagliata.error.code).toBe('VALIDATION');
    const corta = await service.changePassword(r.value.session, {
      currentPassword: 'demo',
      newPassword: 'corta',
    });
    expect(!corta.ok && corta.error.code).toBe('VALIDATION');
    const uguale = await service.changePassword(r.value.session, {
      currentPassword: 'demo',
      newPassword: 'demo',
    });
    expect(uguale.ok).toBe(false);
    // Nulla è cambiato: la vecchia password funziona ancora.
    const ancora = await service.login({
      username: 'admin',
      password: 'demo',
      workstationId: 'ws-p1',
    });
    expect(ancora.ok).toBe(true);
  });

  it("il cambio riuscito toglie l'obbligo, rinnova il token e invalida la provvisoria", async () => {
    const { env, service, admin } = setupConAdmin();
    const reset = await admin.resetPassword(asOperatorId('op-advisor-2'), AMMINISTRATORE);
    if (!reset.ok) {
      throw new Error('reset fallito');
    }
    const login = await service.login({
      username: 'laura.bianchi',
      password: reset.value.temporaryPassword,
      workstationId: 'ws-p3',
    });
    if (!login.ok) {
      throw new Error('login fallito');
    }
    const cambio = await service.changePassword(login.value.session, {
      currentPassword: reset.value.temporaryPassword,
      newPassword: 'la-mia-password-nuova',
    });
    expect(cambio.ok).toBe(true);
    if (!cambio.ok) {
      return;
    }
    expect(cambio.value.session.mustChangePassword).toBe(false);
    expect(cambio.value.session.workstationId).toBe('ws-p3');
    const claims = await verifySessionToken(cambio.value.token, SECRET, env.clock.now());
    expect(claims.ok && claims.value.mustChangePassword).toBe(false);

    const conProvvisoria = await service.login({
      username: 'laura.bianchi',
      password: reset.value.temporaryPassword,
      workstationId: 'ws-p3',
    });
    expect(conProvvisoria.ok).toBe(false);
    const conNuova = await service.login({
      username: 'laura.bianchi',
      password: 'la-mia-password-nuova',
      workstationId: 'ws-p3',
    });
    expect(conNuova.ok && conNuova.value.session.mustChangePassword).toBe(false);
  });

  it('un account KIOSK entra e il suo token si verifica (il ruolo è nel JWT)', async () => {
    const { env, service, admin } = setupConAdmin();
    const creato = await admin.create(
      {
        username: 'tabellone-sala',
        displayName: 'Tabellone sala',
        role: 'KIOSK',
        deskIds: [],
        defaultWorkstationId: null,
        password: 'password-kiosk',
      },
      AMMINISTRATORE,
    );
    expect(creato.ok).toBe(true);
    const r = await service.login({
      username: 'tabellone-sala',
      password: 'password-kiosk',
      workstationId: 'ws-p1',
    });
    expect(r.ok && r.value.session.role).toBe('KIOSK');
    if (r.ok) {
      const claims = await verifySessionToken(r.value.token, SECRET, env.clock.now());
      expect(claims.ok && claims.value.role).toBe('KIOSK');
      // Appena creato: deve ancora scegliere la password.
      expect(claims.ok && claims.value.mustChangePassword).toBe(true);
    }
  });
});

describe('LocalAuthService: accettazioni occupate', () => {
  const login = (service: LocalAuthService, username: string, workstationId: string) =>
    service.login({ username, password: 'demo', workstationId });

  it('la stessa accettazione non può essere scelta da due operatori', async () => {
    const { service } = setup();
    expect((await login(service, 'mario.rossi', 'ws-p1')).ok).toBe(true);
    const laura = await login(service, 'laura.bianchi', 'ws-p1');
    expect(laura.ok).toBe(false);
    if (!laura.ok) {
      expect(laura.error.code).toBe('VALIDATION');
      expect(laura.error.message).toContain('Accettazione 1');
      expect(laura.error.message).toContain('Mario Rossi');
    }
    expect((await login(service, 'laura.bianchi', 'ws-p2')).ok).toBe(true);
  });

  it('lo stesso operatore rientra sul suo posto e, spostandosi, libera il precedente', async () => {
    const { service } = setup();
    expect((await login(service, 'mario.rossi', 'ws-p1')).ok).toBe(true);
    expect((await login(service, 'mario.rossi', 'ws-p1')).ok).toBe(true);
    expect((await login(service, 'mario.rossi', 'ws-p2')).ok).toBe(true);
    // Il posto 1 è libero: Mario ora siede al 2.
    expect((await login(service, 'laura.bianchi', 'ws-p1')).ok).toBe(true);
    expect((await login(service, 'andrea.conti', 'ws-p2')).ok).toBe(false);
  });

  it("il logout libera l'accettazione, ma solo per chi la occupava", async () => {
    const { service } = setup();
    const mario = await login(service, 'mario.rossi', 'ws-p1');
    const laura = await login(service, 'laura.bianchi', 'ws-p2');
    if (!mario.ok || !laura.ok) {
      throw new Error('login falliti');
    }
    // Laura esce con una sessione che punta al posto 2: il posto 1 di Mario non si tocca.
    await service.logout({
      ...laura.value.session,
      workstationId: mario.value.session.workstationId,
    });
    expect((await login(service, 'andrea.conti', 'ws-p1')).ok).toBe(false);
    await service.logout(mario.value.session);
    expect((await login(service, 'andrea.conti', 'ws-p1')).ok).toBe(true);
  });

  it("una sessione scaduta libera l'accettazione da sola", async () => {
    const { env, service } = setup();
    expect((await login(service, 'mario.rossi', 'ws-p1')).ok).toBe(true);
    expect((await login(service, 'laura.bianchi', 'ws-p1')).ok).toBe(false);
    env.clock.advance(9 * 3_600_000);
    expect((await login(service, 'laura.bianchi', 'ws-p1')).ok).toBe(true);
    expect(await env.workstationClaims.listActive(env.clock.nowIso())).toHaveLength(1);
  });
});
