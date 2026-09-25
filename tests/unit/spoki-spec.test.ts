// La specifica di Spoki (scripts/spoki-spec.mjs) e lo script che la applica (scripts/spoki-setup.mjs)
// senza rete. I messaggi usano i template 📅 dell'account (decisione del committente, 2026-09-25):
// ogni variabile dei loro testi deve essere un campo che l'app riempie, e nessun campo in più; il
// template del mattino da creare rispetta i vincoli di Meta; le automazioni hanno la forma
// documentata da Spoki; il piano riconosce ciò che esiste (anche con nomi doppi) e lo script non può
// modificare niente di ciò che c'è.
import { describe, expect, it } from 'vitest';
import { buildTemplateVars } from '@/application/notifications/templates';
import {
  SPOKI_QUICK_REPLIES,
  SPOKI_TEMPLATE_FIELDS,
  SPOKI_TEMPLATE_ID_ENV_KEYS,
  templateFieldsFor,
  type SpokiTemplateKind,
} from '@/infrastructure/messaging/spoki';
import {
  AUTOMAZIONI,
  CAMPI,
  CAMPI_AUTOMAZIONI,
  ESITO_IN_ATTESA,
  PULSANTI,
  PULSANTI_PRENOTAZIONE,
  RISERVA,
  TEMPLATE,
  TEMPLATE_DA_CREARE,
  TEMPLATE_ESISTENTI,
  corpoAutomazioneRete,
  corpoAutomazioneRisposta,
  corpoTemplate,
  variabiliDi,
} from '../../scripts/spoki-spec.mjs';
import {
  aggiornaEnvText,
  chiamataAmmessa,
  parseEnvText,
  pianifica,
} from '../../scripts/spoki-setup.mjs';
import { makeAppointment } from '../helpers/fixtures';

const TUTTI_I_CAMPI = [...CAMPI, ...CAMPI_AUTOMAZIONI];
const IDS = {
  campi: Object.fromEntries(TUTTI_I_CAMPI.map((c, i) => [c.code, 100 + i])),
  template: Object.fromEntries(TEMPLATE.map((t, i) => [t.name, 500 + i])),
};

describe('Template 📅 e campi che l’app riempie', () => {
  it('ogni template usato dall’app: le sue variabili sono esattamente i campi che l’app manda', () => {
    const usati = TEMPLATE.filter((t) => t.tipo !== null);
    expect(usati.map((t) => t.tipo).sort()).toEqual(
      ['CHECK_IN_STARTED', 'CONFIRMATION', 'REMINDER_PREVIOUS_DAY', 'REMINDER_SAME_DAY'].sort(),
    );
    for (const t of usati) {
      const campiApp = Object.keys(SPOKI_TEMPLATE_FIELDS[t.tipo as SpokiTemplateKind] ?? {});
      expect([...new Set(variabiliDi(t.testo))].sort()).toEqual(campiApp.sort());
      // E la variabile d'ambiente con l'id è quella che l'app legge.
      expect(SPOKI_TEMPLATE_ID_ENV_KEYS[t.tipo as SpokiTemplateKind]).toBe(t.env);
    }
  });

  it('i campi dei template sono quelli dell’account (codici esatti, senza doppioni)', () => {
    const codici = CAMPI.map((c) => c.code);
    expect(new Set(codici).size).toBe(codici.length);
    for (const tabella of Object.values(SPOKI_TEMPLATE_FIELDS)) {
      for (const codice of Object.keys(tabella ?? {})) {
        expect(codici).toContain(codice);
      }
    }
    // I campi delle automazioni hanno il prefisso del progetto e non si confondono con quelli.
    for (const c of CAMPI_AUTOMAZIONI) {
      expect(c.code).toMatch(/^ACC_[A-Z0-9_]+$/);
    }
  });

  it('con una pratica vera i campi si riempiono; la sede manca finché non è indicata', () => {
    const a = makeAppointment({
      expectedDelivery: { date: '2026-09-11' as never, time: '17:30' },
    });
    const v = buildTemplateVars(
      a,
      { id: a.brandId, name: 'Fiat' } as never,
      'Europe/Rome',
      'https://officina.example',
      'token-di-prova',
      60,
      { advisorName: 'Laura Bianchi' },
    );
    const variabili = v as unknown as Readonly<Record<string, string>>;
    const accettazione = templateFieldsFor('CHECK_IN_STARTED', variabili);
    expect(accettazione.missing).toEqual([]);
    expect(accettazione.fields).toMatchObject({
      _NOME_ACCETTATORE_: 'Laura Bianchi',
      _DATA_PREVISTA_: '11/09/2026',
      _ORA_PREVISTA_: '17:30',
      _TARGA_: a.vehicle.plate,
    });
    expect(accettazione.fields['_MARCA_E_MODELLO_']).toContain('Fiat');
    // Senza SPOKI_LUOGO il 📅 Reminder 24h non ha la sede: il servizio non lo manda.
    expect(templateFieldsFor('REMINDER_PREVIOUS_DAY', variabili).missing).toEqual(['LUOGO']);
    const conSede = buildTemplateVars(
      a,
      { id: a.brandId, name: 'Fiat' } as never,
      'Europe/Rome',
      '',
      null,
      60,
      { site: 'Autoclub' },
    );
    expect(
      templateFieldsFor('REMINDER_PREVIOUS_DAY', conSede as unknown as Record<string, string>)
        .missing,
    ).toEqual([]);
  });
});

describe('Il template del mattino da creare', () => {
  const mattino = TEMPLATE_DA_CREARE[0]!;

  it('vincoli di Meta: niente variabile in testa o in coda, un esempio per ogni variabile', () => {
    expect(mattino.testo.trim()).not.toMatch(/^%%/);
    expect(mattino.testo.trim()).not.toMatch(/%%$/);
    const corpo = corpoTemplate(mattino) as {
      category: string;
      templatelocalization_set: {
        example_custom_fields: Record<string, string>;
        header_template_component?: { text: string };
        templatebuttoncomponent_set: { button_type: string; text: string }[];
      }[];
    };
    expect(corpo.category).toBe('TRANSACTIONAL');
    const loc = corpo.templatelocalization_set[0]!;
    expect(Object.keys(loc.example_custom_fields).sort()).toEqual(
      [...new Set(variabiliDi(mattino.testo))].sort(),
    );
    expect(Object.values(loc.example_custom_fields).every((e) => e !== 'esempio')).toBe(true);
    expect(loc.header_template_component?.text).toBe('Promemoria Appuntamento Oggi');
    expect(loc.templatebuttoncomponent_set.map((b) => b.button_type)).toEqual([
      'quick_reply',
      'quick_reply',
      'quick_reply',
    ]);
  });

  it('i tre pulsanti: al massimo 20 caratteri, gli stessi payload che l’app manda', () => {
    expect(mattino.pulsanti).toEqual(['Sono arrivato', 'Sono in ritardo', 'Non posso venire']);
    expect(PULSANTI.every((p) => p.testo.length <= 20)).toBe(true);
    expect(PULSANTI.map((p) => p.payload)).toEqual(
      SPOKI_QUICK_REPLIES.REMINDER_SAME_DAY?.map((b) => b.payload),
    );
    // I 📅 hanno «Contattaci» e «Modifica»: l'app manda i loro payload, che la coda ignora.
    expect(PULSANTI_PRENOTAZIONE.map((p) => p.payload)).toEqual(
      SPOKI_QUICK_REPLIES.REMINDER_PREVIOUS_DAY?.map((b) => b.payload),
    );
    for (const t of TEMPLATE_ESISTENTI) {
      expect(t.pulsanti).toEqual(['Contattaci', 'Modifica']);
    }
  });
});

describe('Specifica Spoki: automazioni (per quando saranno decise)', () => {
  it('risposta a un pulsante: azzera i campi, chiama l’app con il segreto, testo del server o di riserva', () => {
    const corpo = corpoAutomazioneRisposta(PULSANTI[0]!, {
      ids: IDS,
      appUrl: 'https://officina.example/',
      inboundSecret: 'segreto-inbound-di-prova-0123456789',
    });
    expect(corpo['name']).toBe(AUTOMAZIONI.arrivato);
    expect(corpo['is_active']).toBe(false);
    expect(corpo.steps.map((s) => s['step_type'])).toEqual([
      'CustomField',
      'CustomField',
      'Webhook',
      'IfElse',
      'FreeMessage',
    ]);
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
    expect(webhook.payload.length).toBeLessThan(4096);
    expect(JSON.parse(webhook.payload)).toEqual({
      source: 'automation',
      phone: '{{ contact.phone }}',
      reply: 'ACTION_ARRIVED',
    });
    expect(webhook.response_data).toEqual({
      'data.esito': IDS.campi['ACC_ESITO'],
      'data.risposta': IDS.campi['ACC_RISPOSTA'],
    });
    expect(corpo.steps[4]).toMatchObject({ text: RISERVA.arrivato });
    // Il testo di riserva usa solo campi che esistono.
    for (const v of variabiliDi(RISERVA.arrivato)) {
      expect(TUTTI_I_CAMPI.map((c) => c.code)).toContain(v);
    }
  });

  it('rete di sicurezza: trigger sulla data ACC_GIORNO, manda il template del mattino', () => {
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
    expect(corpo.steps[1]).toMatchObject({
      template: IDS.template['📅 Promemoria Appuntamento Oggi'],
      custom_field_values: {
        '1': `dynamic_field_${IDS.campi['NOME_CLIENTE']}`,
        '2': `dynamic_field_${IDS.campi['ORA_PRENOTAZIONE']}`,
      },
    });
  });
});

describe('spoki:setup senza rete', () => {
  it('riconosce i 📅 (anche con spazi doppi nel nome), preferisce l’approvato fra i doppioni, segnala il resto', () => {
    const piano = pianifica({
      campi: [
        { id: 7, code: 'NOME_CLIENTE', field_type: 1 },
        { id: 8, code: '_TARGA_', field_type: 1 },
      ],
      template: [
        { id: 454558, name: '📅 Reminder 24h Appuntamento', is_approved: true },
        {
          id: 1,
          name: '📅  Conferma Accettazione',
          is_approved: false,
          templatelocalization_set: [{ language: 'it', status: 'DRAFT' }],
        },
        { id: 454762, name: '📅 Conferma Accettazione', is_approved: true },
      ],
      automazioni: [],
      webhook: [],
    });
    expect(piano.campi.find((c) => c.code === 'NOME_CLIENTE')?.id).toBe(7);
    expect(piano.campi.filter((c) => c.id === null)).toHaveLength(CAMPI.length - 2);
    // Senza --automazioni i campi ACC_* non entrano nel piano.
    expect(piano.campi.some((c) => c.code.startsWith('ACC_'))).toBe(false);
    expect(piano.automazioni).toEqual([]);
    expect(piano.template.find((t) => t.name === '📅 Reminder 24h Appuntamento')).toMatchObject({
      id: 454558,
      stato: 'APPROVED',
      daCreare: false,
      env: 'SPOKI_TEMPLATE_REMINDER_D1_ID',
    });
    expect(piano.template.find((t) => t.name === '📅 Conferma Accettazione')).toMatchObject({
      id: 454762,
      stato: 'APPROVED',
      doppioni: 2,
    });
    expect(piano.template.find((t) => t.name === '📅 Promemoria Appuntamento Oggi')).toMatchObject({
      id: null,
      daCreare: true,
    });
  });

  it('con --automazioni entrano i campi ACC_* e le quattro automazioni', () => {
    const piano = pianifica(
      { campi: [], template: [], automazioni: [], webhook: [] },
      { automazioni: true },
    );
    expect(piano.campi.filter((c) => c.code.startsWith('ACC_'))).toHaveLength(4);
    expect(piano.automazioni).toHaveLength(4);
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

describe('spoki:setup non modifica niente di ciò che esiste (regola del committente)', () => {
  it('legge e crea; non aggiorna né cancella, nemmeno per errore', () => {
    expect(chiamataAmmessa('GET', '/api/1/templates/')).toBe(true);
    expect(chiamataAmmessa('GET', 'https://api.spoki.com/api/1/automations/?page=2')).toBe(true);
    for (const p of [
      '/api/1/custom-fields/',
      '/api/1/templates/',
      '/api/1/automations/',
      '/api/1/external-webhooks/',
    ]) {
      expect(chiamataAmmessa('POST', p)).toBe(true);
    }
    for (const metodo of ['PATCH', 'PUT', 'DELETE']) {
      expect(chiamataAmmessa(metodo, '/api/1/templates/454558/')).toBe(false);
      expect(chiamataAmmessa(metodo, '/api/1/automations/566491/')).toBe(false);
    }
    expect(chiamataAmmessa('POST', '/api/1/external-webhooks/7/rotate_secret/')).toBe(false);
    expect(chiamataAmmessa('POST', '/api/1/templates/91/back_to_draft/')).toBe(false);
    expect(chiamataAmmessa('POST', '/api/1/contacts/sync/')).toBe(false);
  });

  it('l’approvazione a Meta solo per i template creati in questo giro (mai per un 📅)', () => {
    expect(chiamataAmmessa('POST', '/api/1/templates/454558/submit/')).toBe(false);
    expect(chiamataAmmessa('POST', '/api/1/templates/91/submit/', new Set(['91']))).toBe(true);
    expect(chiamataAmmessa('POST', '/api/1/templates/92/submit/', new Set(['91']))).toBe(false);
  });
});
