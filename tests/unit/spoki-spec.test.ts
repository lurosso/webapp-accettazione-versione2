// La specifica di Spoki (scripts/spoki-spec.mjs) e lo script che la applica (scripts/spoki-setup.mjs)
// senza rete: i campi coincidono con quelli che l'app scrive, i testi dei template sono quelli che
// l'app manda (anche via SMS) e rispettano i vincoli di Meta, le automazioni hanno la forma
// documentata da Spoki, il piano riconosce cosa esiste già e .env.local si aggiorna senza perdere
// niente.
import { describe, expect, it } from 'vitest';
import { buildTemplateVars, NOTIFICATION_TEMPLATES } from '@/application/notifications/templates';
import type { NotificationKind } from '@/domain/entities/notification';
import {
  SPOKI_CUSTOM_FIELD_CODES,
  SPOKI_QUICK_REPLIES,
  SPOKI_TEMPLATE_ID_ENV_KEYS,
  TEMPLATE_KIND_BY_KEY,
  type SpokiTemplateKind,
} from '@/infrastructure/messaging/spoki';
import {
  AUTOMAZIONI,
  CAMPI,
  CAMPI_SCRITTI_DALL_APP,
  ESITO_IN_ATTESA,
  PULSANTI,
  RISERVA,
  TEMPLATE,
  componi,
  corpoAutomazioneRete,
  corpoAutomazioneRisposta,
  corpoTemplate,
  variabiliDi,
} from '../../scripts/spoki-spec.mjs';
import { aggiornaEnvText, parseEnvText, pianifica } from '../../scripts/spoki-setup.mjs';
import { makeAppointment } from '../helpers/fixtures';

const IDS = {
  campi: Object.fromEntries(CAMPI.map((c, i) => [c.code, 100 + i])),
  template: Object.fromEntries(TEMPLATE.map((t, i) => [t.name, 500 + i])),
};

describe('Specifica Spoki: campi del contatto', () => {
  it('i campi che scrive l’app sono quelli della specifica, nello stesso ordine', () => {
    expect(CAMPI_SCRITTI_DALL_APP).toEqual([...SPOKI_CUSTOM_FIELD_CODES]);
  });

  it('codici MAIUSCOLI con il prefisso del progetto, nessun doppione, mai un campo riservato', () => {
    const codici = CAMPI.map((c) => c.code);
    expect(new Set(codici).size).toBe(codici.length);
    for (const c of codici) {
      expect(c).toMatch(/^ACC_[A-Z0-9_]+$/);
    }
    // ACC_GIORNO è un campo DATA: fa scattare la rete di sicurezza.
    expect(CAMPI.find((c) => c.code === 'ACC_GIORNO')?.tipo).toBe(2);
  });
});

describe('Specifica Spoki: template', () => {
  it('un template per ogni messaggio che l’app manda via API, con la variabile d’ambiente giusta', () => {
    for (const t of TEMPLATE) {
      expect(SPOKI_TEMPLATE_ID_ENV_KEYS[t.tipo as SpokiTemplateKind]).toBe(t.env);
      expect(t.name).toMatch(/^acc_[a-z0-9_]+$/);
    }
    const conId = Object.entries(SPOKI_TEMPLATE_ID_ENV_KEYS).filter(([, env]) => env !== null);
    expect(TEMPLATE.map((t) => t.tipo).sort()).toEqual(conId.map(([k]) => k).sort());
  });

  it('il testo, riempito, è quello che l’app manda (il promemoria del giorno ha in più le scelte SMS)', () => {
    const a = makeAppointment();
    const v = buildTemplateVars(
      a,
      { id: a.brandId, name: 'Fiat' } as never,
      'Europe/Rome',
      'https://officina.example',
      'token-di-prova',
      60,
    );
    const valori: Record<string, string> = {
      FIRST_NAME: v.firstName,
      ACC_CODICE: v.code,
      ACC_TARGA: v.plate,
      ACC_DATA: v.scheduledDate,
      ACC_ORA: v.scheduledTime,
      ACC_GIORNO: v.scheduledDay,
      ACC_LINK: v.portalUrl,
    };
    for (const t of TEMPLATE) {
      const app = NOTIFICATION_TEMPLATES[t.tipo as NotificationKind].render(v);
      const spoki = componi(t.testo, valori);
      if (t.tipo === 'REMINDER_SAME_DAY') {
        expect(app.startsWith(spoki)).toBe(true);
      } else {
        expect(spoki).toBe(app);
      }
    }
  });

  it('vincoli di Meta: niente variabile in testa o in coda, variabili tutte con un esempio', () => {
    for (const t of TEMPLATE) {
      expect(t.testo.trim()).not.toMatch(/^%%/);
      expect(t.testo.trim()).not.toMatch(/%%$/);
      const corpo = corpoTemplate(t) as {
        templatelocalization_set: { example_custom_fields: Record<string, string> }[];
      };
      const esempi = corpo.templatelocalization_set[0]?.example_custom_fields ?? {};
      expect(Object.keys(esempi).sort()).toEqual([...new Set(variabiliDi(t.testo))].sort());
      expect(Object.values(esempi).every((e) => e !== 'esempio')).toBe(true);
    }
  });

  it('i tre pulsanti rapidi: testi di al massimo 20 caratteri, stessi payload dell’app', () => {
    const giorno = TEMPLATE.find((t) => t.tipo === 'REMINDER_SAME_DAY');
    expect(giorno?.pulsanti).toEqual(['Sono arrivato', 'In ritardo', 'Non posso venire']);
    expect(PULSANTI.every((p) => p.testo.length <= 20)).toBe(true);
    expect(PULSANTI.map((p) => p.payload)).toEqual(
      SPOKI_QUICK_REPLIES.REMINDER_SAME_DAY?.map((b) => b.payload),
    );
    const corpo = corpoTemplate(giorno!) as {
      templatelocalization_set: { templatebuttoncomponent_set: { button_type: string }[] }[];
    };
    expect(
      corpo.templatelocalization_set[0]?.templatebuttoncomponent_set.map((b) => b.button_type),
    ).toEqual(['quick_reply', 'quick_reply', 'quick_reply']);
    // Le chiavi dei template dell'app puntano ai tipi della specifica.
    expect(TEMPLATE_KIND_BY_KEY['reminder_same_day_v1']).toBe('REMINDER_SAME_DAY');
  });
});

describe('Specifica Spoki: automazioni', () => {
  it('risposta a un pulsante: azzera i campi, chiama l’app con il segreto, testo del server o di riserva', () => {
    const pulsante = PULSANTI[0]!;
    const corpo = corpoAutomazioneRisposta(pulsante, {
      ids: IDS,
      appUrl: 'https://officina.example/',
      inboundSecret: 'segreto-inbound-di-prova-0123456789',
    });
    expect(corpo['name']).toBe(AUTOMAZIONI.arrivato);
    expect(corpo['is_active']).toBe(false);
    const tipi = corpo.steps.map((s) => s['step_type']);
    expect(tipi).toEqual(['CustomField', 'CustomField', 'Webhook', 'IfElse', 'FreeMessage']);
    expect(corpo.steps[0]).toMatchObject({
      custom_field: IDS.campi['ACC_ESITO'],
      value: ESITO_IN_ATTESA,
    });
    const webhook = corpo.steps[2] as {
      url: string;
      headers: Record<string, string>;
      payload: string;
      response_data: Record<string, unknown>;
    };
    expect(webhook.url).toBe('https://officina.example/api/v1/webhooks/spoki');
    expect(webhook.headers['x-spoki-secret']).toBe('segreto-inbound-di-prova-0123456789');
    // Il corpo del passo è JSON valido, sotto il limite di Spoki, nella forma che la rotta accetta.
    expect(webhook.payload.length).toBeLessThan(4096);
    expect(JSON.parse(webhook.payload)).toEqual({
      source: 'automation',
      phone: '{{ contact.phone }}',
      reply: 'ACTION_ARRIVED',
      code: '%%ACC_CODICE%%',
    });
    expect(webhook.response_data).toEqual({
      'data.esito': IDS.campi['ACC_ESITO'],
      'data.risposta': IDS.campi['ACC_RISPOSTA'],
    });
    expect(corpo.steps[4]).toMatchObject({ text: RISERVA.arrivato });
    const ramoServer = (corpo.steps[3] as { step_set: Record<string, unknown>[] }).step_set;
    expect(ramoServer.at(-1)).toMatchObject({ step_type: 'FreeMessage', text: '%%ACC_RISPOSTA%%' });
  });

  it('rete di sicurezza: trigger sulla data ACC_GIORNO all’ora indicata, solo con DA_INVIARE', () => {
    const corpo = corpoAutomazioneRete({ ids: IDS, ora: '08:30' });
    expect(corpo['is_active']).toBe(false);
    expect(corpo['fieldconditionstarter_set']).toEqual([
      {
        custom_field: IDS.campi['ACC_GIORNO'],
        operator: '=',
        condition_type: 1,
        time: '08:30:00',
        ignore_year: false,
      },
    ]);
    expect(corpo.steps.map((s) => s['step_type'])).toEqual([
      'IfElse',
      'TemplateMessage',
      'CustomField',
    ]);
    expect(corpo.steps[1]).toMatchObject({
      template: IDS.template['acc_promemoria_giorno'],
      custom_field_values: {
        '1': `dynamic_field_${IDS.campi['ACC_ORA']}`,
        '2': `dynamic_field_${IDS.campi['ACC_TARGA']}`,
      },
    });
    expect(corpo.steps[2]).toMatchObject({
      custom_field: IDS.campi['ACC_PROMEMORIA'],
      value: 'INVIATO',
    });
  });
});

describe('spoki:setup senza rete', () => {
  it('il piano riconosce ciò che esiste (codice e nome) e segnala il resto come mancante', () => {
    const piano = pianifica({
      campi: [
        { id: 7, code: 'acc_codice', field_type: 1 },
        { id: 8, code: 'ACC_GIORNO', field_type: 1 },
      ],
      template: [
        {
          id: 91,
          name: 'acc_promemoria_giorno',
          templatelocalization_set: [{ language: 'it', status: 'Draft' }],
        },
      ],
      automazioni: [{ id: 3, name: AUTOMAZIONI.rete, is_active: true }],
      webhook: [],
    });
    expect(piano.campi.find((c) => c.code === 'ACC_CODICE')?.id).toBe(7);
    // ACC_GIORNO esiste ma come testo: la rete a data non scatterebbe.
    expect(piano.campi.find((c) => c.code === 'ACC_GIORNO')?.tipoGiusto).toBe(false);
    expect(piano.campi.filter((c) => c.id === null)).toHaveLength(CAMPI.length - 2);
    expect(piano.template.find((t) => t.name === 'acc_promemoria_giorno')).toMatchObject({
      id: 91,
      stato: 'DRAFT',
      env: 'SPOKI_TEMPLATE_SAME_DAY_ID',
    });
    expect(piano.automazioni.find((a) => a.chiave === 'rete')).toMatchObject({
      id: 3,
      attiva: true,
    });
    expect(piano.webhook).toEqual([]);
  });

  it('.env.local: aggiorna le variabili presenti, aggiunge le altre in fondo, lascia intatto il resto', () => {
    const prima = [
      '# commento',
      'SPOKI_ENABLED=false',
      'SPOKI_TEMPLATE_SAME_DAY_ID=',
      'ALTRO="con virgolette"',
      '',
    ].join('\n');
    const dopo = aggiornaEnvText(prima, {
      SPOKI_TEMPLATE_SAME_DAY_ID: '91',
      SPOKI_TEMPLATE_REMINDER_D1_ID: '90',
    });
    expect(dopo.split('\n').slice(0, 4)).toEqual([
      '# commento',
      'SPOKI_ENABLED=false',
      'SPOKI_TEMPLATE_SAME_DAY_ID=91',
      'ALTRO="con virgolette"',
    ]);
    expect(dopo).toContain('SPOKI_TEMPLATE_REMINDER_D1_ID=90');
    expect(parseEnvText(dopo)).toMatchObject({
      SPOKI_ENABLED: 'false',
      SPOKI_TEMPLATE_SAME_DAY_ID: '91',
      SPOKI_TEMPLATE_REMINDER_D1_ID: '90',
      ALTRO: 'con virgolette',
    });
  });
});
