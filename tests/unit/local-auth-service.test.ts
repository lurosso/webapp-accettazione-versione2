import { describe, expect, it } from 'vitest';
import { OperatorAdminService } from '@/application/admin/OperatorAdminService';
import { LocalAuthService } from '@/application/auth/LocalAuthService';
import { signSessionToken, verifySessionToken } from '@/application/auth/session-token';
import { sessionOnlyClaimKey } from '@/domain/entities/workstation-claim';
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
      username: 'mario.rossi',
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

describe('LocalAuthService: sportelli occupati', () => {
  const login = (service: LocalAuthService, username: string, workstationId: string) =>
    service.login({ username, password: 'demo', workstationId });

  it('lo stesso sportello non può essere scelto da due operatori', async () => {
    const { service } = setup();
    expect((await login(service, 'mario.rossi', 'ws-p1')).ok).toBe(true);
    const laura = await login(service, 'laura.bianchi', 'ws-p1');
    expect(laura.ok).toBe(false);
    if (!laura.ok) {
      expect(laura.error.code).toBe('VALIDATION');
      expect(laura.error.message).toContain('Sportello A');
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

  it('dopo un cambio di postazione il logout libera quella NUOVA, anche con la sessione vecchia in mano', async () => {
    const { service } = setup();
    const mario = await login(service, 'mario.rossi', 'ws-p1');
    if (!mario.ok) {
      throw new Error('login fallito');
    }
    // Mario si sposta al posto 2: il posto 1 si libera, il 2 diventa suo.
    const spostato = await service.switchWorkstation(mario.value.session, 'ws-p2');
    expect(spostato.ok).toBe(true);
    expect((await login(service, 'andrea.conti', 'ws-p2')).ok).toBe(false);

    // Esce con la sessione VECCHIA, che nomina ancora il posto 1: è il cookie che il client può
    // avere in mano se il cambio non l'ha ancora aggiornato. Liberare «il posto del cookie» qui
    // non libererebbe niente, e il 2 resterebbe il posto fantasma di fine giornata.
    await service.logout(mario.value.session);
    expect((await login(service, 'andrea.conti', 'ws-p2')).ok).toBe(true);
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

describe("LocalAuthService: l'amministratore non occupa sportelli", () => {
  const login = (service: LocalAuthService, username: string, workstationId: string | null) =>
    service.login({ username, password: 'demo', workstationId });

  it('entra senza sportello anche se ne ha scelto uno, e lo sportello resta libero', async () => {
    const { env, service } = setup();
    const r = await login(service, 'admin', 'ws-p1');
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.value.session.workstationId).toBeNull();
    expect((await service.verify(r.value.token)).ok).toBe(true);
    // Nessuna postazione occupata: l'accettatore si siede proprio lì.
    expect(await env.workstationClaims.listActive(env.clock.nowIso())).toEqual([]);
    expect((await login(service, 'mario.rossi', 'ws-p1')).ok).toBe(true);
    // Il token lo dice: nessuna postazione.
    const token = await verifySessionToken(r.value.token, SECRET, env.clock.now());
    expect(token.ok && token.value.workstationId).toBeNull();
  });

  it('entra anche con tutti gli sportelli occupati; l’accettatore senza sportello no', async () => {
    const { service } = setup();
    for (const [chi, dove] of [
      ['mario.rossi', 'ws-p1'],
      ['laura.bianchi', 'ws-p2'],
      ['andrea.conti', 'ws-p3'],
    ] as const) {
      expect((await login(service, chi, dove)).ok).toBe(true);
    }
    expect((await login(service, 'admin', null)).ok).toBe(true);
    expect((await login(service, 'admin', '')).ok).toBe(true);
    const senza = await login(service, 'mario.rossi', null);
    expect(senza.ok).toBe(false);
    expect(!senza.ok && senza.error.message).toContain('Scegli uno sportello libero');
  });

  it('una sola sessione valida anche per lui: il secondo accesso ritira il primo, il logout la chiude', async () => {
    const { service } = setup();
    const primo = await login(service, 'admin', null);
    const secondo = await login(service, 'admin', null);
    if (!primo.ok || !secondo.ok) {
      throw new Error('login falliti');
    }
    expect((await service.verify(secondo.value.token)).ok).toBe(true);
    await service.logout(secondo.value.session);
    expect((await service.verify(secondo.value.token)).ok).toBe(false);
  });

  it('il secondo accesso da un altro dispositivo ritira la sessione precedente', async () => {
    const { env, service } = setup();
    const primo = await login(service, 'admin', null);
    env.clock.advance(5_000);
    const secondo = await login(service, 'admin', null);
    if (!primo.ok || !secondo.ok) {
      throw new Error('login falliti');
    }
    const vecchia = await service.verify(primo.value.token);
    expect(vecchia.ok).toBe(false);
    expect(!vecchia.ok && vecchia.error.message).toContain('Sessione sostituita');
    expect((await service.verify(secondo.value.token)).ok).toBe(true);
  });

  it('una sessione di prima (admin seduto a uno sportello) non vale più e libera subito il posto', async () => {
    const { env, service } = setup();
    const admin = await env.operators.findByUsername('admin');
    if (admin === null) {
      throw new Error('admin del seed');
    }
    // Come la emetteva il codice precedente: postazione nel token e posto occupato.
    const issuedAt = env.clock.nowIso();
    const expiresAt = new Date(env.clock.now().getTime() + 8 * 3_600_000).toISOString();
    const token = await signSessionToken(
      {
        operatorId: admin.id,
        username: admin.username,
        displayName: admin.displayName,
        role: 'ADMIN',
        workstationId: 'ws-p1' as never,
        deskIds: admin.deskIds,
        mustChangePassword: false,
        issuedAt,
        expiresAt: expiresAt as never,
      },
      SECRET,
    );
    await env.workstationClaims.upsert({
      workstationId: 'ws-p1' as never,
      operatorId: admin.id,
      operatorName: admin.displayName,
      claimedAt: issuedAt,
      expiresAt: expiresAt as never,
    });
    expect((await login(service, 'mario.rossi', 'ws-p1')).ok).toBe(false);

    const r = await service.verify(token);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.message).toContain('accedi di nuovo');
    expect((await login(service, 'mario.rossi', 'ws-p1')).ok).toBe(true);
  });

  it('non cambia sportello, e il cambio password lo lascia senza', async () => {
    const { env, service } = setup();
    const r = await login(service, 'admin', null);
    if (!r.ok) {
      throw new Error('login fallito');
    }
    const cambio = await service.switchWorkstation(r.value.session, 'ws-p2');
    expect(cambio.ok).toBe(false);
    expect(!cambio.ok && cambio.error.message).toContain('non occupa sportelli');
    env.clock.advance(2_000);
    const nuova = await service.changePassword(r.value.session, {
      currentPassword: 'demo',
      newPassword: 'una-password-nuova-lunga',
    });
    expect(nuova.ok && nuova.value.session.workstationId).toBeNull();
    if (nuova.ok) {
      expect((await service.verify(nuova.value.token)).ok).toBe(true);
    }
    // La chiave della sessione esiste, ma fra le postazioni occupate non compare.
    expect(
      await env.workstationClaims.findByWorkstation(
        sessionOnlyClaimKey(r.value.session.operatorId),
      ),
    ).not.toBeNull();
    expect(await env.workstationClaims.listActive(env.clock.nowIso())).toEqual([]);
  });
});
