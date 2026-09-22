// Segnalazioni di disfunzione: nascono complete (codice, componente, chi, da dove), passano di
// stato solo lungo i passaggi ammessi e ogni cambiamento pubblica un evento per il cruscotto.
import { describe, expect, it } from 'vitest';
import { SystemAlertService } from '@/application/system/SystemAlertService';
import type { DomainEvent } from '@/domain/events';
import { asOperatorId, asSystemAlertId, asWorkstationId } from '@/domain/ids';
import { buildTestEnv } from '../helpers/fixtures';

function setup() {
  const env = buildTestEnv();
  const eventi: DomainEvent[] = [];
  env.eventBus.subscribe((e) => {
    eventi.push(e);
  });
  const service = new SystemAlertService({
    alerts: env.systemAlerts,
    referenceData: env.referenceData,
    eventBus: env.eventBus,
    clock: env.clock,
    ids: env.ids,
    logger: env.logger,
  });
  const accettatore = {
    operatorId: asOperatorId('op-advisor-1'),
    displayName: 'Mario Rossi',
    workstationId: asWorkstationId('ws-p2'),
  };
  const admin = {
    operatorId: asOperatorId('op-admin-1'),
    displayName: 'Amministratore',
    workstationId: null,
  };
  return { env, eventi, service, accettatore, admin };
}

describe('Segnalazioni di sistema: creazione', () => {
  it('porta codice normalizzato, componente, messaggio, chi ha segnalato e il nome della postazione', async () => {
    const { service, eventi, accettatore, env } = setup();
    const r = await service.create(
      {
        code: 'infinity-down',
        component: 'INFINITY',
        message: '  Infinity non risponde da 10 minuti ',
      },
      accettatore,
      'corr-1',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.value.code).toBe('INFINITY-DOWN');
    expect(r.value.status).toBe('NEW');
    expect(r.value.message).toBe('Infinity non risponde da 10 minuti');
    expect(r.value.reportedByName).toBe('Mario Rossi');
    expect(r.value.workstationId).toBe('ws-p2');
    // Il nome della postazione arriva dai dati di riferimento, non dal client.
    const postazione = await env.referenceData.findWorkstationById(asWorkstationId('ws-p2'));
    expect(r.value.workstationName).toBe(postazione?.name ?? null);
    expect(r.value.createdAt).toBe(env.clock.nowIso());
    expect(eventi.filter((e) => e.type === 'SYSTEM_ALERT_CHANGED')).toHaveLength(1);
    const evento = eventi[0];
    expect(evento?.type === 'SYSTEM_ALERT_CHANGED' && evento.alertId).toBe(r.value.id);
    expect(evento?.actor).toEqual({ kind: 'OPERATOR', id: 'op-advisor-1' });
  });

  it('rifiuta codice fuori forma, componente sconosciuto e messaggio vuoto o troppo lungo', async () => {
    const { service, accettatore } = setup();
    const codice = await service.create(
      { code: 'codice con spazi', component: 'SYNC', message: 'x' },
      accettatore,
      'c',
    );
    expect(!codice.ok && codice.error.code).toBe('VALIDATION');
    const componente = await service.create(
      { code: 'X-1', component: 'FRIGORIFERO', message: 'x' },
      accettatore,
      'c',
    );
    expect(!componente.ok && componente.error.code).toBe('VALIDATION');
    const vuoto = await service.create(
      { code: 'X-1', component: 'OTHER', message: '   ' },
      accettatore,
      'c',
    );
    expect(!vuoto.ok && vuoto.error.code).toBe('VALIDATION');
    const lungo = await service.create(
      { code: 'X-1', component: 'OTHER', message: 'a'.repeat(501) },
      accettatore,
      'c',
    );
    expect(!lungo.ok && lungo.error.code).toBe('VALIDATION');
    expect(await service.list(true)).toHaveLength(0);
  });
});

describe('Segnalazioni di sistema: elenco, stati e riepilogo', () => {
  it('l’elenco è dalla più recente; le risolte compaiono solo se richieste', async () => {
    const { service, accettatore, admin, env } = setup();
    const prima = await service.create(
      { code: 'A-1', component: 'HARDWARE', message: 'prima' },
      accettatore,
      'c',
    );
    env.clock.advance(60_000);
    const seconda = await service.create(
      { code: 'A-2', component: 'NETWORK', message: 'seconda' },
      accettatore,
      'c',
    );
    if (!prima.ok || !seconda.ok) {
      throw new Error('creazione fallita');
    }
    const risolta = await service.updateStatus(
      prima.value.id,
      'RESOLVED',
      admin,
      'c',
      'Cambiato il cavo',
    );
    expect(risolta.ok && risolta.value.resolvedAt).toBe(env.clock.nowIso());
    expect(risolta.ok && risolta.value.adminNote).toBe('Cambiato il cavo');
    expect(risolta.ok && risolta.value.handledByName).toBe('Amministratore');

    expect((await service.list(false)).map((a) => a.code)).toEqual(['A-2']);
    expect((await service.list(true)).map((a) => a.code)).toEqual(['A-2', 'A-1']);
    expect(await service.summary()).toEqual({ new: 1, inProgress: 0, resolved: 1 });
  });

  it('i passaggi di stato seguono il flusso nuova → in gestione → risolta, con riapertura', async () => {
    const { service, accettatore, admin, eventi } = setup();
    const r = await service.create(
      { code: 'S-1', component: 'SYNC', message: 'sync fallita' },
      accettatore,
      'c',
    );
    if (!r.ok) {
      throw new Error('creazione fallita');
    }
    const id = r.value.id;
    expect((await service.updateStatus(id, 'NEW', admin, 'c')).ok).toBe(false);
    expect((await service.updateStatus(id, 'IN_PROGRESS', admin, 'c')).ok).toBe(true);
    expect((await service.updateStatus(id, 'IN_PROGRESS', admin, 'c')).ok).toBe(false);
    expect((await service.updateStatus(id, 'RESOLVED', admin, 'c')).ok).toBe(true);
    expect((await service.updateStatus(id, 'IN_PROGRESS', admin, 'c')).ok).toBe(false);
    const riaperta = await service.updateStatus(id, 'NEW', admin, 'c');
    expect(riaperta.ok && riaperta.value.status).toBe('NEW');
    expect(riaperta.ok && riaperta.value.resolvedAt).toBeNull();
    // Un evento per la creazione e uno per ogni passaggio riuscito.
    expect(eventi.filter((e) => e.type === 'SYSTEM_ALERT_CHANGED')).toHaveLength(4);
    const sconosciuta = await service.updateStatus(
      asSystemAlertId('non-esiste'),
      'RESOLVED',
      admin,
      'c',
    );
    expect(!sconosciuta.ok && sconosciuta.error.code).toBe('NOT_FOUND');
  });
});
