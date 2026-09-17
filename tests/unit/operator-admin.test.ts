import { describe, expect, it } from 'vitest';
import { OperatorAdminService } from '@/application/admin/OperatorAdminService';
import { asOperatorId } from '@/domain/ids';
import { verifyPassword } from '@/lib/hash-password';
import { buildTestEnv } from '../helpers/fixtures';

function setup() {
  const env = buildTestEnv();
  const admin = new OperatorAdminService({
    operators: env.operators,
    referenceData: env.referenceData,
    ids: env.ids,
    logger: env.logger,
  });
  return { env, admin };
}

/** L'amministratore del seed è l'unico con ruolo ADMIN. */
const AMMINISTRATORE = { operatorId: asOperatorId('op-admin') };

describe('OperatorAdminService: elenco e creazione', () => {
  it('elenca tutti gli operatori con i codici degli sportelli, senza hash delle password', async () => {
    const { admin } = setup();
    const elenco = await admin.list();
    expect(elenco.length).toBeGreaterThanOrEqual(5);
    const mario = elenco.find((o) => o.username === 'mario.rossi');
    expect(mario?.role).toBe('ADVISOR');
    expect(mario?.mustChangePassword).toBe(false);
    expect(mario?.deskCodes).toEqual(['FCA']);
    expect(Object.keys(mario ?? {})).not.toContain('passwordHash');
  });

  it('crea un operatore con password cifrata e sportelli validi', async () => {
    const { env, admin } = setup();
    const r = await admin.create(
      {
        username: 'Anna.Verdi',
        displayName: 'Anna Verdi',
        role: 'ADVISOR',
        deskIds: ['desk-s2'],
        defaultWorkstationId: 'ws-p1',
        password: 'segreta-lunga',
      },
      AMMINISTRATORE,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Il nome utente è normalizzato in minuscolo: si cerca senza sorprese.
      expect(r.value.username).toBe('anna.verdi');
      expect(r.value.deskCodes).toEqual(['PSA']);
      expect(r.value.isActive).toBe(true);
      // La password iniziale la conosce anche l'amministratore: va cambiata al primo accesso.
      expect(r.value.mustChangePassword).toBe(true);
    }
    const salvato = await env.operators.findByUsername('anna.verdi');
    expect(salvato).not.toBeNull();
    expect(salvato?.passwordHash).not.toContain('segreta');
    expect(verifyPassword('segreta-lunga', salvato!.passwordHash)).toBe(true);
  });

  it('rifiuta nome utente duplicato, password corta e sportello sconosciuto', async () => {
    const { admin } = setup();
    const base = {
      displayName: 'Prova',
      role: 'ADVISOR' as const,
      deskIds: [],
      defaultWorkstationId: null,
      password: 'password-valida',
    };
    const duplicato = await admin.create({ ...base, username: 'MARIO.ROSSI' }, AMMINISTRATORE);
    expect(duplicato.ok).toBe(false);

    const corta = await admin.create(
      { ...base, username: 'nuovo.utente', password: 'corta' },
      AMMINISTRATORE,
    );
    expect(corta.ok).toBe(false);

    const sportello = await admin.create(
      { ...base, username: 'nuovo.utente', deskIds: ['desk-inesistente'] },
      AMMINISTRATORE,
    );
    expect(sportello.ok).toBe(false);
    if (!sportello.ok) {
      expect(sportello.error.code).toBe('VALIDATION');
    }
  });

  it('accetta il ruolo KIOSK per gli account dei dispositivi', async () => {
    const { admin } = setup();
    const r = await admin.create(
      {
        username: 'monitor-sala',
        displayName: 'Monitor sala d’attesa',
        role: 'KIOSK',
        deskIds: [],
        defaultWorkstationId: null,
        password: 'kiosk-password',
      },
      AMMINISTRATORE,
    );
    expect(r.ok && r.value.role).toBe('KIOSK');
  });
});

describe('OperatorAdminService: modifica e sicurezza', () => {
  it('cambia nome, ruolo e sportelli', async () => {
    const { admin } = setup();
    const r = await admin.update(
      asOperatorId('op-advisor-1'),
      { displayName: 'Mario Rossi Senior', role: 'SUPERVISOR', deskIds: ['desk-s1', 'desk-s2'] },
      AMMINISTRATORE,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.displayName).toBe('Mario Rossi Senior');
      expect(r.value.role).toBe('SUPERVISOR');
      expect(r.value.deskCodes).toEqual(['FCA', 'PSA']);
    }
  });

  it('disattiva e riattiva un accettatore', async () => {
    const { env, admin } = setup();
    const spento = await admin.update(
      asOperatorId('op-advisor-2'),
      { isActive: false },
      AMMINISTRATORE,
    );
    expect(spento.ok && spento.value.isActive).toBe(false);
    // Un operatore disattivato non compare più fra gli attivi (quindi non entra), ma esiste ancora.
    expect((await env.operators.listActive()).some((o) => o.id === 'op-advisor-2')).toBe(false);
    expect(await env.operators.findById(asOperatorId('op-advisor-2'))).not.toBeNull();

    const riacceso = await admin.update(
      asOperatorId('op-advisor-2'),
      { isActive: true },
      AMMINISTRATORE,
    );
    expect(riacceso.ok && riacceso.value.isActive).toBe(true);
  });

  it('un amministratore non può disattivare sé stesso né togliersi il ruolo', async () => {
    const { admin } = setup();
    const spegnersi = await admin.update(
      AMMINISTRATORE.operatorId,
      { isActive: false },
      AMMINISTRATORE,
    );
    expect(spegnersi.ok).toBe(false);
    const degradarsi = await admin.update(
      AMMINISTRATORE.operatorId,
      { role: 'ADVISOR' },
      AMMINISTRATORE,
    );
    expect(degradarsi.ok).toBe(false);
  });

  it("l'ultimo amministratore attivo non può essere disattivato da nessuno", async () => {
    const { admin } = setup();
    const altro = { operatorId: asOperatorId('op-supervisor') };
    const r = await admin.update(AMMINISTRATORE.operatorId, { isActive: false }, altro);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toContain('ultimo amministratore');
    }
  });

  it('con un secondo amministratore attivo, il primo può essere disattivato', async () => {
    const { admin } = setup();
    await admin.create(
      {
        username: 'secondo.admin',
        displayName: 'Secondo Admin',
        role: 'ADMIN',
        deskIds: [],
        defaultWorkstationId: null,
        password: 'password-admin',
      },
      AMMINISTRATORE,
    );
    const r = await admin.update(
      AMMINISTRATORE.operatorId,
      { isActive: false },
      { operatorId: asOperatorId('secondo.admin-non-serve') },
    );
    expect(r.ok && r.value.isActive).toBe(false);
  });

  it('il reset genera una password provvisoria leggibile che funziona al login', async () => {
    const { env, admin } = setup();
    const r = await admin.resetPassword(asOperatorId('op-advisor-1'), AMMINISTRATORE);
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    // Formato dettabile a voce: tre blocchi di quattro, senza caratteri ambigui.
    expect(r.value.temporaryPassword).toMatch(
      /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/,
    );
    const salvato = await env.operators.findById(asOperatorId('op-advisor-1'));
    expect(verifyPassword(r.value.temporaryPassword, salvato!.passwordHash)).toBe(true);
    expect(verifyPassword('demo', salvato!.passwordHash)).toBe(false);
    expect(salvato?.mustChangePassword).toBe(true);
    expect(r.value.operator.mustChangePassword).toBe(true);
  });

  it('un operatore inesistente restituisce NOT_FOUND', async () => {
    const { admin } = setup();
    const r = await admin.update(asOperatorId('nessuno'), { isActive: false }, AMMINISTRATORE);
    expect(!r.ok && r.error.code).toBe('NOT_FOUND');
  });
});
