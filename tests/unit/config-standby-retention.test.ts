// Due interruttori di configurazione: lo standby della messaggistica e la retention dei media.
import { describe, expect, it } from 'vitest';
import { DEFAULT_MEDIA_HARD_DELETE_DAYS, DEFAULT_MEDIA_RETENTION_DAYS } from '@/config/constants';
import { parseEnv } from '@/config/env';

const muto = () => undefined;

describe('MESSAGING_STANDBY: integrazione con il cliente in pausa', () => {
  it('è spento di default e si accende da .env senza avvisi', () => {
    const avvisi: string[] = [];
    expect(parseEnv({}, muto).messagingStandby).toBe(false);
    expect(parseEnv({ MESSAGING_STANDBY: 'true' }, (m) => avvisi.push(m)).messagingStandby).toBe(
      true,
    );
    expect(parseEnv({ MESSAGING_STANDBY: 'false' }, muto).messagingStandby).toBe(false);
    expect(avvisi).toEqual([]);
  });

  it("non tocca il resto della configurazione: l'officina lavora comunque", () => {
    const env = parseEnv({ MESSAGING_STANDBY: 'true' }, muto);
    // I promemoria restano "abilitati" nella configurazione: è il container a fermarli, così
    // togliendo lo standby si torna al comportamento di prima senza altre modifiche. I messaggi a
    // evento sono spenti di serie dal 2026-09-25 (solo promemoria e conferma del cliente).
    expect(env.remindersEnabled).toBe(true);
    expect(env.messagingTriggersEnabled).toBe(false);
    expect(parseEnv({ MESSAGING_TRIGGERS_ENABLED: 'true' }, muto).messagingTriggersEnabled).toBe(
      true,
    );
    expect(env.infinityProvider).toBe('mock');
  });
});

describe('Retention dei media: configurabile, con il vecchio nome ancora valido', () => {
  it('senza variabili usa i valori predefiniti (tre mesi di file)', () => {
    const env = parseEnv({}, muto);
    expect(env.photoRetentionDays).toBe(DEFAULT_MEDIA_RETENTION_DAYS);
    expect(env.photoRetentionDays).toBe(90);
    expect(env.photoHardDeleteDays).toBe(DEFAULT_MEDIA_HARD_DELETE_DAYS);
  });

  it('MEDIA_RETENTION_DAYS decide la conservazione dei file', () => {
    expect(parseEnv({ MEDIA_RETENTION_DAYS: '60' }, muto).photoRetentionDays).toBe(60);
    expect(parseEnv({ MEDIA_HARD_DELETE_DAYS: '120' }, muto).photoHardDeleteDays).toBe(120);
  });

  it('un .env scritto con i vecchi nomi continua a valere, ma il nome nuovo prevale', () => {
    expect(parseEnv({ PHOTO_RETENTION_DAYS: '45' }, muto).photoRetentionDays).toBe(45);
    expect(
      parseEnv({ PHOTO_RETENTION_DAYS: '45', MEDIA_RETENTION_DAYS: '90' }, muto).photoRetentionDays,
    ).toBe(90);
    expect(parseEnv({ PHOTO_HARD_DELETE_DAYS: '30' }, muto).photoHardDeleteDays).toBe(30);
  });

  it('un valore non numerico non ferma l’avvio: avvisa e ricade sul predefinito', () => {
    const avvisi: string[] = [];
    const env = parseEnv({ MEDIA_RETENTION_DAYS: 'due mesi' }, (m) => avvisi.push(m));
    expect(env.photoRetentionDays).toBe(DEFAULT_MEDIA_RETENTION_DAYS);
    expect(avvisi.some((m) => m.includes('MEDIA_RETENTION_DAYS'))).toBe(true);
  });
});
