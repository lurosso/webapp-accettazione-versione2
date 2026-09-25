// Cosa l'account Spoki deve avere per i WhatsApp dell'accettazione. È la fonte unica di
// `npm run spoki:setup` (scripts/spoki-setup.mjs) e di docs/SPOKI.md; un test
// (tests/unit/spoki-spec.test.ts) controlla che ogni variabile dei testi sia un campo che l'app
// riempie (`SPOKI_TEMPLATE_FIELDS` in src/infrastructure/messaging/spoki/spoki-config.ts).
//
// DECISIONI DEL COMMITTENTE (2026-09-25):
// - i template da usare sono quelli dell'account che iniziano con 📅, fatti apposta per questo
//   sistema e già approvati: si verificano, non si toccano;
// - ciò che esiste nell'account (template, campi, automazioni, contatti) non si modifica mai;
// - per il promemoria del mattino con i tre pulsanti della coda non c'è un 📅: se ne crea uno
//   nuovo, nello stesso stile, in bozza; l'approvazione a Meta la chiede il committente.
//
// Formato Spoki (API REST ufficiale, collezione Postman letta il 2026-09-24): campo personalizzato
// { label, code, field_type: 1 testo | 2 data, example }; template { name, category,
// templatelocalization_set: [{ language, header/body/footer, templatebuttoncomponent_set,
// example_custom_fields }] }, nasce in bozza; automazione { name, is_active, steps, *_set } — il
// trigger «clic su un pulsante di un template» non è nell'API e si sceglie nell'editor.

/** Tipi di campo di Spoki. */
export const TIPO_CAMPO = { TESTO: 1, DATA: 2 };

/**
 * I campi che i template usano. Esistono già nell'account (li usano i 📅): lo script li verifica e
 * non li crea se non mancano davvero.
 */
export const CAMPI = [
  {
    code: 'NOME_CLIENTE',
    tipo: TIPO_CAMPO.TESTO,
    esempio: 'Mario Rossi',
    descrizione: 'Nome e cognome del cliente (o ragione sociale)',
  },
  {
    code: 'DATA_PRENOTAZIONE',
    tipo: TIPO_CAMPO.TESTO,
    esempio: '26/09/2026',
    descrizione: "Data dell'appuntamento (GG/MM/AAAA), 📅 Reminder 24h",
  },
  {
    code: 'ORA_PRENOTAZIONE',
    tipo: TIPO_CAMPO.TESTO,
    esempio: '09:30',
    descrizione: "Ora dell'appuntamento (HH:mm)",
  },
  {
    code: 'DATA',
    tipo: TIPO_CAMPO.TESTO,
    esempio: '26/09/2026',
    descrizione: "Data dell'appuntamento, 📅 Conferma Prenotazione",
  },
  {
    code: 'ORA',
    tipo: TIPO_CAMPO.TESTO,
    esempio: '09:30',
    descrizione: "Ora dell'appuntamento, 📅 Conferma Prenotazione",
  },
  {
    code: 'LUOGO',
    tipo: TIPO_CAMPO.TESTO,
    esempio: 'Autoclub',
    descrizione: 'Sede (SPOKI_LUOGO): ancora da indicare',
  },
  {
    code: '_MARCA_E_MODELLO_',
    tipo: TIPO_CAMPO.TESTO,
    esempio: 'Fiat Panda 1.0 Hybrid',
    descrizione: 'Marca e modello del veicolo',
  },
  { code: '_TARGA_', tipo: TIPO_CAMPO.TESTO, esempio: 'AB123CD', descrizione: 'Targa del veicolo' },
  {
    code: '_NOME_ACCETTATORE_',
    tipo: TIPO_CAMPO.TESTO,
    esempio: 'Laura Bianchi',
    descrizione: 'Chi ha preso in carico la pratica',
  },
  {
    code: '_DATA_PREVISTA_',
    tipo: TIPO_CAMPO.TESTO,
    esempio: '26/09/2026',
    descrizione: 'Riconsegna prevista secondo Infinity (GG/MM/AAAA)',
  },
  {
    code: '_ORA_PREVISTA_',
    tipo: TIPO_CAMPO.TESTO,
    esempio: '17:00',
    descrizione: 'Ora prevista di riconsegna (HH:mm)',
  },
];

/**
 * Campi delle automazioni ancora da decidere (risposte ai pulsanti a server giù, rete di sicurezza
 * del mattino): NON esistono nell'account e si creano solo insieme alle automazioni
 * (`--automazioni`), quando il committente lo dice.
 */
export const CAMPI_AUTOMAZIONI = [
  {
    code: 'ACC_GIORNO',
    tipo: TIPO_CAMPO.DATA,
    esempio: '2026-09-26',
    descrizione: "Giorno dell'appuntamento: fa scattare la rete di sicurezza del mattino",
  },
  {
    code: 'ACC_PROMEMORIA',
    tipo: TIPO_CAMPO.TESTO,
    esempio: 'DA_INVIARE',
    descrizione: 'Stato del promemoria del mattino: DA_INVIARE, INVIATO, NON_SERVE',
  },
  {
    code: 'ACC_ESITO',
    tipo: TIPO_CAMPO.TESTO,
    esempio: 'ARRIVATO',
    descrizione: "Esito restituito dal server all'automazione (ATTESA finché non risponde)",
  },
  {
    code: 'ACC_RISPOSTA',
    tipo: TIPO_CAMPO.TESTO,
    esempio: 'Perfetto! Sei stato inserito in fila…',
    descrizione: 'Testo della risposta preparato dal server',
  },
];

/** Valore di ACC_ESITO prima del webhook: se resta così, il server non ha risposto. */
export const ESITO_IN_ATTESA = 'ATTESA';

/** Valore di ACC_RISPOSTA prima del webhook: «nessun testo dal server». */
export const RISPOSTA_VUOTA = '-';

/** I tre pulsanti del promemoria del mattino: testo (max 20 caratteri) e payload. */
export const PULSANTI = [
  { testo: 'Sono arrivato', payload: 'ACTION_ARRIVED', chiave: 'arrivato' },
  { testo: 'Sono in ritardo', payload: 'ACTION_LATE', chiave: 'ritardo' },
  { testo: 'Non posso venire', payload: 'ACTION_ABSENT', chiave: 'assente' },
];

/** I pulsanti dei template 📅. */
export const PULSANTI_PRENOTAZIONE = [
  { testo: 'Contattaci', payload: 'ACTION_CONTACT' },
  { testo: 'Modifica', payload: 'ACTION_CHANGE' },
];

/**
 * I template 📅 approvati, come stanno nell'account (letti il 2026-09-25). `tipo` è il messaggio
 * dell'app (tipo Spoki), `env` la variabile che ne porta l'id; null = non ancora usato dall'app.
 */
export const TEMPLATE_ESISTENTI = [
  {
    name: '📅 Reminder 24h Appuntamento',
    tipo: 'REMINDER_PREVIOUS_DAY',
    env: 'SPOKI_TEMPLATE_REMINDER_D1_ID',
    testo:
      'Gentile %%NOME_CLIENTE%% ,\nle ricordiamo che il suo appuntamento presso la nostra officina è previsto per domani.\n\n Di seguito il riepilogo:\n\n📅 *Data:* %%DATA_PRENOTAZIONE%%\n⏰ *Ora:* %%ORA_PRENOTAZIONE%%\n📍 *Sede:* %%LUOGO%%\n🚗 *Veicolo*: %%_MARCA_E_MODELLO_%%\n🔢 *Targa*: %%_TARGA_%%\n\nQualora avesse necessità di modificare o annullare l’appuntamento, la invitiamo a comunicarcelo quanto prima rispondendo a questo messaggio\nLa ringraziamo per la collaborazione e restiamo a disposizione.\n A presto\n_Il Team Autoclub_',
    pulsanti: PULSANTI_PRENOTAZIONE.map((p) => p.testo),
  },
  {
    name: '📅 Conferma Accettazione',
    tipo: 'CHECK_IN_STARTED',
    env: 'SPOKI_TEMPLATE_WELCOME_ID',
    testo:
      'Gentile %%NOME_CLIENTE%% ,\nla informiamo che la sua vettura è stata presa in carico dalla nostra officina.\n\nDi seguito i dettagli:\n\n👤Accettatore: %%_NOME_ACCETTATORE_%%\n🚗 *Veicolo*: %%_MARCA_E_MODELLO_%%\n🔢 *Targa*: %%_TARGA_%%\n📆 *Data prevista di riconsegna* : %%_DATA_PREVISTA_%%\n🕒 *Orario prevista di riconsegna* : %%_ORA_PREVISTA_%%\n\nPer il ritiro attenda sempre nostra comunicazione di pronto vettura.\nPer qualsiasi aggiornamento sullo stato di avanzamento dei lavori, può rispondere a questo messaggio.\nGrazie per la fiducia\n\n_Il Team Autoclub_',
    pulsanti: PULSANTI_PRENOTAZIONE.map((p) => p.testo),
  },
  {
    name: '📅 Conferma Prenotazione',
    tipo: 'CONFIRMATION',
    env: 'SPOKI_TEMPLATE_BOOKING_ID',
    testo:
      'Gentile %%NOME_CLIENTE%%,\nla ringraziamo per aver prenotato un intervento presso la nostra officina.\n\n Di seguito il riepilogo del suo appuntamento:\n\n📅 *Data:* %%DATA%%\n⏰ *Ora:* %%ORA%%\n📍 *Sede:* %%LUOGO%%\n🚗 *Veicolo*: %%_MARCA_E_MODELLO_%%\n🔢 *Targa*: %%_TARGA_%%\n\n⚠️ Per eventuali modifiche o necessità, non esiti a contattarci rispondendo a questo messaggio\nGrazie per la fiducia e a presto!\n_Il Team Autoclub_',
    pulsanti: PULSANTI_PRENOTAZIONE.map((p) => p.testo),
  },
  {
    // Vettura pronta per il ritiro: un momento dell'officina, non dell'accettazione. Non usato.
    name: '📅 Notifica Pronto Vettura',
    tipo: null,
    env: null,
    testo:
      'Gentile %%NOME_CLIENTE%% ,\nla informiamo che la sua vettura è pronta per il ritiro presso la nostra officina.\n\nDi seguito i dettagli:\n🚗 *Veicolo*: %%_MARCA_E_MODELLO_%%\n🔢 *Targa*: %%_TARGA_%%\n🕒 *Orario di ritiro* : dal lunedì al venerdì 8:00-12:30 e 15:00-17:30\n\nLa invitiamo a comunicarci eventuali esigenze particolari per il ritiro, rispondendo a questo messaggio, così da poterla assistere al meglio.\n\nGrazie per la fiducia e a presto\n_Il Team Autoclub_',
    pulsanti: PULSANTI_PRENOTAZIONE.map((p) => p.testo),
  },
];

/**
 * Il template da creare (in bozza): il promemoria del mattino con i tre pulsanti della coda, nello
 * stile dei 📅 e con i loro campi. Meta non accetta un corpo che comincia o finisce con una
 * variabile: il testo finisce con la firma.
 */
export const TEMPLATE_DA_CREARE = [
  {
    name: '📅 Promemoria Appuntamento Oggi',
    tipo: 'REMINDER_SAME_DAY',
    env: 'SPOKI_TEMPLATE_SAME_DAY_ID',
    intestazione: 'Promemoria Appuntamento Oggi',
    testo:
      "Gentile %%NOME_CLIENTE%%,\nle ricordiamo che il suo appuntamento presso la nostra officina è previsto per oggi.\n\n⏰ *Ora:* %%ORA_PRENOTAZIONE%%\n🚗 *Veicolo*: %%_MARCA_E_MODELLO_%%\n🔢 *Targa*: %%_TARGA_%%\n\nPer aiutarci a gestire l'accettazione, ci dica con un tocco qui sotto quando è arrivato, se è in ritardo o se non può venire.\n_Il Team Autoclub_",
    pulsanti: PULSANTI.map((p) => p.testo),
  },
];

/** Tutti i template che l'app usa o prepara. */
export const TEMPLATE = [...TEMPLATE_ESISTENTI, ...TEMPLATE_DA_CREARE];

/** Stesso nome a meno di spazi doppi (l'account ha «📅  Notifica Pronto Vettura»). */
export function stessoNome(a, b) {
  const n = (s) =>
    String(s ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  return n(a) === n(b);
}

/** Esempi per la revisione di Meta: un valore per ogni variabile usata nei testi. */
export const ESEMPI = Object.fromEntries(
  [...CAMPI, ...CAMPI_AUTOMAZIONI].map((c) => [c.code, c.esempio]),
);

/** Le variabili `%%CODICE%%` di un testo, nell'ordine in cui compaiono. */
export function variabiliDi(testo) {
  return [...testo.matchAll(/%%([A-Z0-9_]+)%%/g)].map((m) => m[1]);
}

/** Il testo con le variabili sostituite. */
export function componi(testo, valori) {
  return testo.replace(/%%([A-Z0-9_]+)%%/g, (_, codice) => valori[codice] ?? '');
}

/** Corpo di `POST /api/1/templates/` per un template da creare. */
export function corpoTemplate(t) {
  const usate = [...new Set(variabiliDi(t.testo))];
  return {
    name: t.name,
    category: 'UTILITY',
    templatelocalization_set: [
      {
        language: 'it',
        ...(t.intestazione === undefined
          ? {}
          : {
              header_template_component: {
                component_type: 'header',
                parameters: [],
                format: 'text',
                text: t.intestazione,
              },
            }),
        body_template_component: {
          component_type: 'body',
          parameters: [],
          format: null,
          text: t.testo,
        },
        templatebuttoncomponent_set: t.pulsanti.map((testo, order) => ({
          component_type: null,
          text: testo,
          order,
          button_type: 'quick_reply',
          phone_number: null,
          form_id: null,
          url: null,
          send_as_shortlink: null,
        })),
        example_custom_fields: Object.fromEntries(usate.map((c) => [c, ESEMPI[c] ?? 'esempio'])),
      },
    ],
  };
}

/** Testi di riserva delle automazioni di risposta: il cliente li riceve a server giù. */
export const RISERVA = {
  arrivato:
    'Grazie! Abbiamo ricevuto la sua conferma di arrivo per la vettura %%_TARGA_%%: si accomodi, la chiameremo a breve.',
  ritardo:
    "Grazie per l'avviso! Abbiamo informato l'accettazione del suo ritardo. Quando arriva in officina avvisi il nostro personale.",
  assente:
    'Grazie per la comunicazione, abbiamo preso nota che oggi non potrà venire. Un nostro operatore la ricontatterà per fissare un nuovo appuntamento.',
};

/** Nomi delle automazioni (servono anche per ritrovarle nell'account). */
export const AUTOMAZIONI = {
  arrivato: 'ACC · Risposta «Sono arrivato»',
  ritardo: 'ACC · Risposta «Sono in ritardo»',
  assente: 'ACC · Risposta «Non posso venire»',
  rete: 'ACC · Rete di sicurezza promemoria del mattino',
};

/** Indirizzo del webhook dell'app a partire dall'indirizzo pubblico. */
export function urlWebhook(appUrl) {
  return `${appUrl.replace(/\/+$/, '')}/api/v1/webhooks/spoki`;
}

/** Condizione di un passo IfElse su un campo personalizzato (struttura a due livelli di Spoki). */
function condizioneCampo(idCampo, codice, condizione, valore) {
  return {
    and_conditions: [
      {
        and_conditions: [
          {
            key: `dynamic_field_${idCampo}`,
            condition: condizione,
            value: valore,
            metadata: codice,
          },
        ],
      },
    ],
  };
}

/**
 * Corpo di `POST /api/1/automations/` per la risposta a un pulsante del promemoria del mattino.
 * Passi: ACC_ESITO = ATTESA e ACC_RISPOSTA = «-»; webhook verso l'app con il segreto delle risposte
 * (la risposta JSON finisce nei campi: data.esito → ACC_ESITO, data.risposta → ACC_RISPOSTA); se
 * ACC_ESITO è ancora ATTESA il server è giù e parte il testo di riserva, altrimenti quello del
 * server. Nasce disattivata e senza trigger (si sceglie nell'editor).
 */
export function corpoAutomazioneRisposta(pulsante, { ids, appUrl, inboundSecret }) {
  const esito = ids.campi.ACC_ESITO;
  const risposta = ids.campi.ACC_RISPOSTA;
  const payload = JSON.stringify({
    source: 'automation',
    phone: '{{ contact.phone }}',
    reply: pulsante.payload,
  });
  return {
    name: AUTOMAZIONI[pulsante.chiave],
    description: `Risponde al pulsante «${pulsante.testo}» del promemoria del mattino anche a server giù, poi avvisa l'app (docs/SPOKI.md).`,
    is_active: false,
    steps: [
      { step_type: 'CustomField', custom_field: esito, value: ESITO_IN_ATTESA },
      { step_type: 'CustomField', custom_field: risposta, value: RISPOSTA_VUOTA },
      {
        step_type: 'Webhook',
        url: urlWebhook(appUrl),
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-spoki-secret': inboundSecret },
        payload,
        response_data: { 'data.esito': esito, 'data.risposta': risposta },
      },
      {
        step_type: 'IfElse',
        conditions: condizioneCampo(esito, 'ACC_ESITO', 'equal_to', ESITO_IN_ATTESA),
        // Ramo «falso»: il server ha risposto. Se ha mandato un testo, si consegna quello.
        step_set: [
          {
            step_type: 'IfElse',
            conditions: condizioneCampo(risposta, 'ACC_RISPOSTA', 'not_equal_to', RISPOSTA_VUOTA),
            step_set: [],
          },
          { step_type: 'FreeMessage', text: '%%ACC_RISPOSTA%%' },
        ],
      },
      // Ramo «vero»: il server non ha risposto.
      { step_type: 'FreeMessage', text: RISERVA[pulsante.chiave] },
    ],
  };
}

/**
 * Corpo di `POST /api/1/automations/` per la rete di sicurezza: trigger sulla data ACC_GIORNO
 * all'ora della rete; se ACC_PROMEMORIA vale ancora DA_INVIARE manda il promemoria del mattino e lo
 * segna INVIATO. Nasce disattivata.
 */
export function corpoAutomazioneRete({ ids, ora }) {
  const promemoria = ids.campi.ACC_PROMEMORIA;
  const template = TEMPLATE_DA_CREARE.find((t) => t.tipo === 'REMINDER_SAME_DAY');
  return {
    name: AUTOMAZIONI.rete,
    description:
      "Manda il promemoria del mattino a chi non l'ha ricevuto dal server (ACC_PROMEMORIA = DA_INVIARE) (docs/SPOKI.md).",
    is_active: false,
    fieldconditionstarter_set: [
      {
        custom_field: ids.campi.ACC_GIORNO,
        operator: '=',
        condition_type: 1,
        time: `${ora}:00`,
        ignore_year: false,
      },
    ],
    steps: [
      {
        step_type: 'IfElse',
        conditions: condizioneCampo(promemoria, 'ACC_PROMEMORIA', 'equal_to', 'DA_INVIARE'),
        step_set: [],
      },
      {
        step_type: 'TemplateMessage',
        template: ids.template[template.name],
        custom_field_values: Object.fromEntries(
          variabiliDi(template.testo).map((c, i) => [
            String(i + 1),
            `dynamic_field_${ids.campi[c]}`,
          ]),
        ),
      },
      { step_type: 'CustomField', custom_field: promemoria, value: 'INVIATO' },
    ],
  };
}

/** I due webhook V2 dell'account (uno per evento, ognuno con il suo segreto whsec_…). */
export const EVENTI_WEBHOOK = ['message.inbound', 'message.outbound'];
