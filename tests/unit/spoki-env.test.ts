// Le variabili dell'integrazione Spoki: l'interruttore SPOKI_ENABLED, la modalità effettiva, gli id
// dei template, il segreto dei webhook. Un .env.local scritto prima di queste chiavi resta valido.
import { describe, expect, it } from 'vitest';
import { parseEnv } from '@/config/env';

const muto = () => undefined;

describe('SPOKI_ENABLED e modalità effettiva', () => {
  it('di default l’integrazione è spenta, in simulazione, con blocco di sicurezza e senza segreto webhook', () => {
    const env = parseEnv({}, muto);
    expect(env.spokiEnabled).toBe(false);
    expect(env.spokiMode).toBe('simulation');
    expect(env.spokiSafetyLock).toBe(true);
    expect(env.spokiApiKey).toBeNull();
    expect(env.spokiApiBaseUrl).toBe('https://api.spoki.com');
    expect(env.spokiTemplateWelcomeId).toBeNull();
    expect(env.spokiTemplateCompleteId).toBeNull();
    expect(env.spokiWebhookSecret).toBeNull();
  });

  it('SPOKI_MODE=live senza interruttore acceso resta simulazione, e lo dice', () => {
    const avvisi: string[] = [];
    const env = parseEnv({ SPOKI_MODE: 'live', SPOKI_API_KEY: 'k'.repeat(20) }, (m) =>
      avvisi.push(m),
    );
    expect(env.spokiMode).toBe('simulation');
    expect(avvisi.some((m) => m.includes('SPOKI_ENABLED=false'))).toBe(true);
  });

  it('SPOKI_MODE=live con interruttore acceso ma senza chiave API resta simulazione, e lo dice', () => {
    const avvisi: string[] = [];
    const env = parseEnv({ SPOKI_MODE: 'live', SPOKI_ENABLED: 'true' }, (m) => avvisi.push(m));
    expect(env.spokiEnabled).toBe(true);
    expect(env.spokiMode).toBe('simulation');
    expect(avvisi.some((m) => m.includes('SPOKI_API_KEY assente'))).toBe(true);
  });

  it('live effettivo solo con SPOKI_MODE=live, SPOKI_ENABLED=true e SPOKI_API_KEY; il safety lock resta a parte', () => {
    const avvisi: string[] = [];
    const env = parseEnv(
      { SPOKI_MODE: 'live', SPOKI_ENABLED: 'true', SPOKI_API_KEY: 'k'.repeat(20) },
      (m) => avvisi.push(m),
    );
    expect(env.spokiMode).toBe('live');
    expect(env.spokiSafetyLock).toBe(true);
    expect(avvisi).toEqual([]);
  });

  it('con SPOKI_ENABLED=true e SPOKI_MODE=simulation nessun avviso: la simulazione è una scelta', () => {
    const avvisi: string[] = [];
    const env = parseEnv({ SPOKI_ENABLED: 'true', SPOKI_MODE: 'simulation' }, (m) =>
      avvisi.push(m),
    );
    expect(env.spokiMode).toBe('simulation');
    expect(avvisi).toEqual([]);
  });
});

describe('Template via API e webhook degli esiti', () => {
  it('gli id dei template e la base delle API si leggono così come sono (barra finale tolta)', () => {
    const env = parseEnv(
      {
        SPOKI_TEMPLATE_WELCOME_ID: '3068',
        SPOKI_TEMPLATE_COMPLETE_ID: ' 3069 ',
        SPOKI_API_BASE_URL: 'https://api.spoki.example/',
      },
      muto,
    );
    expect(env.spokiTemplateWelcomeId).toBe('3068');
    expect(env.spokiTemplateCompleteId).toBe('3069');
    expect(env.spokiApiBaseUrl).toBe('https://api.spoki.example');
  });

  it('un segreto dei webhook troppo corto viene ignorato con un avviso; uno vero passa', () => {
    const avvisi: string[] = [];
    expect(
      parseEnv({ SPOKI_WEBHOOK_SECRET: 'corto' }, (m) => avvisi.push(m)).spokiWebhookSecret,
    ).toBe(null);
    expect(avvisi.some((m) => m.includes('SPOKI_WEBHOOK_SECRET'))).toBe(true);
    expect(
      parseEnv({ SPOKI_WEBHOOK_SECRET: 'segreto-webhook-di-prova-0003' }, muto).spokiWebhookSecret,
    ).toBe('segreto-webhook-di-prova-0003');
  });

  it('le chiavi di prima (provider, URL e segreti delle automazioni, inbound) valgono ancora', () => {
    const env = parseEnv(
      {
        SPOKI_PROVIDER: 'real',
        SPOKI_URL_REMINDER_SAME_DAY: 'https://api.spoki.com/wh/ap/x/',
        SPOKI_SECRET_REMINDER_SAME_DAY: 's'.repeat(32),
        SPOKI_INBOUND_SECRET: 'i'.repeat(48),
      },
      muto,
    );
    expect(env.spokiProvider).toBe('real');
    expect(env.spokiUrlReminderSameDay).toBe('https://api.spoki.com/wh/ap/x/');
    expect(env.spokiSecretReminderSameDay).toBe('s'.repeat(32));
    expect(env.spokiInboundSecret).toBe('i'.repeat(48));
  });

  describe('Id dei template di promemoria e risposte ai pulsanti', () => {
    it('si leggono dalle cinque variabili dedicate e sono null se assenti', () => {
      const vuoto = parseEnv({}, muto);
      expect(vuoto.spokiTemplateReminderD1Id).toBeNull();
      expect(vuoto.spokiTemplateSameDayId).toBeNull();
      expect(vuoto.spokiTemplateArrivedReplyId).toBeNull();
      expect(vuoto.spokiTemplateLateReplyId).toBeNull();
      expect(vuoto.spokiTemplateAbsentReplyId).toBeNull();
      const env = parseEnv(
        {
          SPOKI_TEMPLATE_REMINDER_D1_ID: '4000',
          SPOKI_TEMPLATE_SAME_DAY_ID: '4001',
          SPOKI_TEMPLATE_ARRIVED_REPLY_ID: '4002',
          SPOKI_TEMPLATE_LATE_REPLY_ID: '4003',
          SPOKI_TEMPLATE_ABSENT_REPLY_ID: '4004',
        },
        muto,
      );
      expect(env.spokiTemplateReminderD1Id).toBe('4000');
      expect(env.spokiTemplateSameDayId).toBe('4001');
      expect(env.spokiTemplateArrivedReplyId).toBe('4002');
      expect(env.spokiTemplateLateReplyId).toBe('4003');
      expect(env.spokiTemplateAbsentReplyId).toBe('4004');
    });
  });
});

describe('SPOKI_MAX_EARLY_ARRIVAL_MINUTES: finestra dell’arrivo prematuro', () => {
  it('vale 60 di default, si legge da .env e un valore non valido ricade sul predefinito con avviso', () => {
    const avvisi: string[] = [];
    expect(parseEnv({}, muto).spokiMaxEarlyArrivalMinutes).toBe(60);
    expect(
      parseEnv({ SPOKI_MAX_EARLY_ARRIVAL_MINUTES: '120' }, muto).spokiMaxEarlyArrivalMinutes,
    ).toBe(120);
    expect(
      parseEnv({ SPOKI_MAX_EARLY_ARRIVAL_MINUTES: '0' }, muto).spokiMaxEarlyArrivalMinutes,
    ).toBe(0);
    expect(
      parseEnv({ SPOKI_MAX_EARLY_ARRIVAL_MINUTES: '-5' }, (m) => avvisi.push(m))
        .spokiMaxEarlyArrivalMinutes,
    ).toBe(60);
    expect(avvisi.some((m) => m.includes('SPOKI_MAX_EARLY_ARRIVAL_MINUTES'))).toBe(true);
    expect(
      parseEnv({ SPOKI_TEMPLATE_EARLY_REPLY_ID: '4005' }, muto).spokiTemplateEarlyReplyId,
    ).toBe('4005');
  });
});

describe('Demo interna: SPOKI_ALLOWED_RECIPIENTS e SPOKI_PUBLIC_SENDS', () => {
  it('di default nessun numero ammesso e invii al pubblico chiusi', () => {
    const env = parseEnv({}, muto);
    expect(env.spokiAllowedRecipients).toEqual([]);
    expect(env.spokiPublicSends).toBe(false);
  });

  it('i numeri si normalizzano in E.164, senza doppioni; quelli non validi si scartano con avviso', () => {
    const avvisi: string[] = [];
    const env = parseEnv(
      { SPOKI_ALLOWED_RECIPIENTS: ' 333 123 4567, +39 333 1234567 ,0039 347 0000000, ciao ' },
      (m) => avvisi.push(m),
    );
    expect(env.spokiAllowedRecipients).toEqual(['+393331234567', '+393470000000']);
    expect(avvisi.some((m) => m.includes('SPOKI_ALLOWED_RECIPIENTS'))).toBe(true);
    expect(parseEnv({ SPOKI_PUBLIC_SENDS: 'true' }, muto).spokiPublicSends).toBe(true);
  });
});
