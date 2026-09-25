import { describe, expect, it } from 'vitest';
import { DevQuickLoginService, DEV_USERNAME_PREFIX } from '@/application/auth/DevQuickLoginService';
import { LocalAuthService } from '@/application/auth/LocalAuthService';
import { parseEnv } from '@/config/env';
import { asOperatorId, asWorkstationId } from '@/domain/ids';
import { buildTestEnv } from '../helpers/fixtures';

function setup() {
  const env = buildTestEnv();
  const auth = new LocalAuthService({
    operators: env.operators,
    referenceData: env.referenceData,
    claims: env.workstationClaims,
    clock: env.clock,
    logger: env.logger,
    secret: 'segreto-di-prova-lungo-almeno-trentadue-caratteri',
    ttlHours: 8,
  });
  const quick = new DevQuickLoginService({
    operators: env.operators,
    referenceData: env.referenceData,
    claims: env.workstationClaims,
    auth,
    clock: env.clock,
    logger: env.logger,
  });
  return { env, auth, quick };
}

describe('Accesso veloce di sviluppo (DEV_QUICK_LOGIN)', () => {
  it('propone amministratore e un accettatore per ogni sportello attivo (niente più BDC)', async () => {
    const { env, quick } = setup();
    const profili = await quick.profiles();
    expect(profili.map((p) => p.id)).toEqual([
      'admin',
      ...env.seed.desks.map((d) => `accettatore-${d.code.toLowerCase()}`),
    ]);
    expect(profili.every((p) => p.username.startsWith(DEV_USERNAME_PREFIX))).toBe(true);
  });

  it("crea l'account dev.* al primo uso, lo riusa dopo, e la sessione ha il ruolo e lo sportello del profilo", async () => {
    const { env, quick } = setup();
    const prima = (await env.operators.listAll()).length;

    const admin = await quick.login('admin');
    expect(admin.ok).toBe(true);
    if (admin.ok) {
      expect(admin.value.session.role).toBe('ADMIN');
      expect(admin.value.session.username).toBe('dev.admin');
      expect(admin.value.session.mustChangePassword).toBe(false);
      expect(admin.value.session.deskIds).toEqual(env.seed.desks.map((d) => d.id));
      expect(admin.value.token.length).toBeGreaterThan(20);
    }
    await quick.login('admin');
    expect((await env.operators.listAll()).length).toBe(prima + 1);

    const s2 = await quick.login('accettatore-psa');
    expect(s2.ok).toBe(true);
    if (s2.ok) {
      expect(s2.value.session.role).toBe('ADVISOR');
      expect(s2.value.session.deskIds).toEqual([env.seed.desks[1]!.id]);
      const postazione = env.seed.workstations.find((w) => w.id === s2.value.session.workstationId);
      expect(postazione?.deskId).toBe(env.seed.desks[1]!.id);
    }
    // Gli account veri del seed non sono stati toccati.
    const admin0 = await env.operators.findByUsername('admin');
    expect(admin0?.displayName).toBe('Luca Moretti');
  });

  it("sceglie il primo sportello libero dell'area; un profilo ignoto è NOT_FOUND", async () => {
    const { env, quick } = setup();
    // Lo sportello A (area FCA) è occupato da un collega: l'accettatore FCA entra sul B.
    await env.workstationClaims.upsert({
      workstationId: asWorkstationId('ws-p1'),
      operatorId: asOperatorId('op-advisor-1'),
      operatorName: 'Mario Rossi',
      claimedAt: env.clock.nowIso(),
      expiresAt: '2099-01-01T00:00:00.000Z' as never,
    });
    const s1 = await quick.login('accettatore-fca');
    expect(s1.ok && s1.value.session.workstationId === asWorkstationId('ws-p2')).toBe(true);

    const ignoto = await quick.login('direttore');
    expect(!ignoto.ok && ignoto.error.code === 'NOT_FOUND').toBe(true);
  });

  it('DEV_QUICK_LOGIN: acceso di default fuori dalla produzione, mai in produzione', () => {
    expect(parseEnv({}, () => undefined).devQuickLogin).toBe(true);
    expect(parseEnv({ DEV_QUICK_LOGIN: 'false' }, () => undefined).devQuickLogin).toBe(false);
    const avvisi: string[] = [];
    const prod = parseEnv({ NODE_ENV: 'production', DEV_QUICK_LOGIN: 'true' }, (m) =>
      avvisi.push(m),
    );
    expect(prod.devQuickLogin).toBe(false);
    expect(avvisi.some((m) => m.includes('DEV_QUICK_LOGIN'))).toBe(true);
    expect(parseEnv({ NODE_ENV: 'production' }, () => undefined).devQuickLogin).toBe(false);
  });
});

describe('Accesso veloce: l’amministratore non occupa sportelli', () => {
  it('entra senza postazione e le accettazioni restano tutte libere', async () => {
    const { env, auth, quick } = setup();
    const r = await quick.login('admin');
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.value.session.role).toBe('ADMIN');
    expect(r.value.session.workstationId).toBeNull();
    expect((await auth.verify(r.value.token)).ok).toBe(true);
    expect(await env.workstationClaims.listActive(env.clock.nowIso())).toEqual([]);
  });
});
