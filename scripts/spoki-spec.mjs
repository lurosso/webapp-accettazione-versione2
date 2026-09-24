// Cosa deve esistere nell'account Spoki perché WhatsApp funzioni anche a server giù: campi
// personalizzati del contatto, template da far approvare a Meta, automazioni e webhook V2. È la
// fonte unica di `npm run spoki:setup` (scripts/spoki-setup.mjs) e di docs/SPOKI.md; un test
// (tests/unit/spoki-spec.test.ts) controlla che i codici dei campi coincidano con quelli che l'app
// scrive e che i testi dei template siano quelli che l'app manda anche via SMS.
//
// Formato Spoki (API REST ufficiale, collezione Postman letta il 2026-09-24):
// - campo personalizzato: { label, code (MAIUSCOLO), field_type: 1 testo | 2 data | 3 data e ora,
//   example } — `POST /api/1/custom-fields/`, al massimo 5 chiamate al minuto;
// - template: { name (snake_case), category, templatelocalization_set: [{ language,
//   body_template_component: { text con %%CODICE%% }, templatebuttoncomponent_set, … }] } —
//   `POST /api/1/templates/`, nasce in bozza; `POST /api/1/templates/<id>/submit/` lo manda a Meta;
// - automazione: { name, is_active, steps: [...], fieldconditionstarter_set? } —
//   `POST /api/1/automations/`. Il trigger «clic su un pulsante di un template» NON è fra quelli
//   dell'API: per le tre risposte ai pulsanti si sceglie nell'editor di Spoki (docs/SPOKI.md).

/** Prefisso di tutto ciò che il progetto crea in Spoki: lo separa dal resto dell'account. */
export const PREFISSO = 'ACC';

/** Tipi di campo di Spoki. */
export const TIPO_CAMPO = { TESTO: 1, DATA: 2 };

/**
 * Campi del contatto. I primi sette li scrive l'app a ogni invio (stesso elenco di
 * `SPOKI_CUSTOM_FIELD_CODES` in src/infrastructure/messaging/spoki/spoki-config.ts); gli ultimi due
 * li usano solo le automazioni dei pulsanti, per ricevere l'esito e il testo dal webhook.
 */
export const CAMPI = [
  {
    code: 'ACC_CODICE',
    tipo: TIPO_CAMPO.TESTO,
    esempio: 'F041',
    descrizione: 'Codice della pratica in coda',
  },
  {
    code: 'ACC_TARGA',
    tipo: TIPO_CAMPO.TESTO,
    esempio: 'AB123CD',
    descrizione: 'Targa del veicolo',
  },
  {
    code: 'ACC_DATA',
    tipo: TIPO_CAMPO.TESTO,
    esempio: '24/09/2026',
    descrizione: "Data dell'appuntamento da leggere (GG/MM/AAAA)",
  },
  {
    code: 'ACC_ORA',
    tipo: TIPO_CAMPO.TESTO,
    esempio: '09:30',
    descrizione: "Orario dell'appuntamento (HH:mm)",
  },
  {
    code: 'ACC_GIORNO',
    tipo: TIPO_CAMPO.DATA,
    esempio: '2026-09-24',
    descrizione: "Giorno dell'appuntamento: fa scattare la rete di sicurezza del mattino",
  },
  {
    code: 'ACC_LINK',
    tipo: TIPO_CAMPO.TESTO,
    esempio: 'https://officina.example/portal/abc123',
    descrizione: 'Smart link personale al portale cliente',
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

/** I campi che scrive l'app (gli altri due servono solo alle automazioni). */
export const CAMPI_SCRITTI_DALL_APP = CAMPI.slice(0, 7).map((c) => c.code);

/** Valore di ACC_ESITO prima del webhook: se resta così, il server non ha risposto. */
export const ESITO_IN_ATTESA = 'ATTESA';

/** Valore di ACC_RISPOSTA prima del webhook: «nessun testo dal server». */
export const RISPOSTA_VUOTA = '-';

/** I tre pulsanti del promemoria del giorno: testo (max 20 caratteri), payload e risposta dell'app. */
export const PULSANTI = [
  { testo: 'Sono arrivato', payload: 'ACTION_ARRIVED', chiave: 'arrivato' },
  { testo: 'In ritardo', payload: 'ACTION_LATE', chiave: 'ritardo' },
  { testo: 'Non posso venire', payload: 'ACTION_ABSENT', chiave: 'assente' },
];

/**
 * Template da far approvare (categoria UTILITY: comunicazioni di servizio su un appuntamento già
 * preso). `tipo` è il messaggio dell'app (NotificationKind), `env` la variabile che ne porta l'id.
 * Meta non accetta un corpo che comincia o finisce con una variabile: i testi finiscono con parole.
 */
export const TEMPLATE = [
  {
    name: 'acc_promemoria_giorno_prima',
    tipo: 'REMINDER_PREVIOUS_DAY',
    env: 'SPOKI_TEMPLATE_REMINDER_D1_ID',
    testo:
      'Gentile cliente, le ricordiamo il suo appuntamento in AutoClub per domani %%ACC_DATA%% alle ore %%ACC_ORA%% per la vettura targa %%ACC_TARGA%%. A domani!',
    pulsanti: [],
  },
  {
    name: 'acc_promemoria_giorno',
    tipo: 'REMINDER_SAME_DAY',
    env: 'SPOKI_TEMPLATE_SAME_DAY_ID',
    // Su WhatsApp le tre scelte sono pulsanti; il testo SMS dell'app aggiunge le scelte numerate.
    testo:
      "Buongiorno! Le ricordiamo l'appuntamento di oggi alle ore %%ACC_ORA%% per la vettura %%ACC_TARGA%%. Per aiutarci a gestire la fila, selezioni un'opzione:",
    pulsanti: PULSANTI.map((p) => p.testo),
  },
  {
    name: 'acc_arrivo_confermato',
    tipo: 'ARRIVAL_CONFIRMED',
    env: 'SPOKI_TEMPLATE_ARRIVED_REPLY_ID',
    testo:
      "Perfetto! Sei stato inserito in fila con il codice %%ACC_CODICE%%. Puoi monitorare l'attesa in tempo reale da questo link personalizzato: %%ACC_LINK%% Ti chiameremo con il tuo codice.",
    pulsanti: [],
  },
  {
    name: 'acc_ritardo_confermato',
    tipo: 'LATE_CONFIRMED',
    env: 'SPOKI_TEMPLATE_LATE_REPLY_ID',
    testo:
      "Grazie per l'avviso! Abbiamo informato l'accettazione del tuo ritardo. Quando sarai giunto in officina, avvisa il nostro personale o clicca 'Sono arrivato'.",
    pulsanti: [],
  },
  {
    name: 'acc_assenza_confermata',
    tipo: 'ABSENT_CONFIRMED',
    env: 'SPOKI_TEMPLATE_ABSENT_REPLY_ID',
    testo:
      "Grazie per la comunicazione. Abbiamo annullato la prenotazione di oggi. Un nostro operatore la ricontatterà per riprogrammare l'appuntamento.",
    pulsanti: [],
  },
  {
    name: 'acc_arrivo_troppo_presto',
    tipo: 'ARRIVAL_TOO_EARLY',
    env: 'SPOKI_TEMPLATE_EARLY_REPLY_ID',
    testo:
      "Il tuo appuntamento in AutoClub è previsto per le %%ACC_ORA%%. È ancora un po' presto per l'inserimento in fila! Ti invitiamo a premere nuovamente 'Sono arrivato' quando sarai nei pressi dell'officina (al massimo 60 minuti prima dell'orario).",
    pulsanti: [],
  },
  {
    name: 'acc_accettazione_iniziata',
    tipo: 'CHECK_IN_STARTED',
    env: 'SPOKI_TEMPLATE_WELCOME_ID',
    testo:
      'Buongiorno %%FIRST_NAME%%, la sua vettura %%ACC_TARGA%% è in accettazione presso Autoclub Group (pratica %%ACC_CODICE%%). Segua lo stato in tempo reale dal suo link personale: %%ACC_LINK%% Grazie per averci scelto.',
    pulsanti: [],
  },
  {
    name: 'acc_accettazione_completata',
    tipo: 'CHECK_IN_COMPLETED',
    env: 'SPOKI_TEMPLATE_COMPLETE_ID',
    testo:
      'Procedura di accettazione completata. Grazie per la visita, puoi proseguire! (Autoclub Group, pratica %%ACC_CODICE%%)',
    pulsanti: [],
  },
];

/** Esempi per la revisione di Meta: un valore per ogni variabile usata nei testi. */
export const ESEMPI = Object.fromEntries([
  ['FIRST_NAME', 'Mario'],
  ...CAMPI.map((c) => [c.code, c.esempio]),
]);

/** Le variabili `%%CODICE%%` di un testo, nell'ordine in cui compaiono. */
export function variabiliDi(testo) {
  return [...testo.matchAll(/%%([A-Z0-9_]+)%%/g)].map((m) => m[1]);
}

/** Il testo con le variabili sostituite (per confrontarlo con quello dell'app). */
export function componi(testo, valori) {
  return testo.replace(/%%([A-Z0-9_]+)%%/g, (_, codice) => valori[codice] ?? '');
}

/** Corpo di `POST /api/1/templates/` per un template della specifica. */
export function corpoTemplate(t) {
  const usate = variabiliDi(t.testo);
  return {
    name: t.name,
    category: 'UTILITY',
    templatelocalization_set: [
      {
        language: 'it',
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

/** Testi di riserva delle automazioni: il cliente li riceve quando il server non risponde. */
export const RISERVA = {
  arrivato:
    'Grazie! Abbiamo ricevuto la sua conferma di arrivo per la vettura %%ACC_TARGA%%. Il suo codice è %%ACC_CODICE%%: si accomodi, la chiameremo con questo codice.',
  ritardo:
    "Grazie per l'avviso! Abbiamo informato l'accettazione del suo ritardo. Quando arriva in officina avvisi il nostro personale.",
  assente:
    'Grazie per la comunicazione, abbiamo preso nota che oggi non potrà venire. Un nostro operatore la ricontatterà per fissare un nuovo appuntamento.',
};

/** Nomi delle automazioni (servono anche per ritrovarle nell'account). */
export const AUTOMAZIONI = {
  arrivato: 'ACC · Risposta «Sono arrivato»',
  ritardo: 'ACC · Risposta «In ritardo»',
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
 * Corpo di `POST /api/1/automations/` per la risposta a un pulsante. Passi:
 * 1. ACC_ESITO = ATTESA e ACC_RISPOSTA = «-» (azzerati: dicono se il server ha risposto);
 * 2. webhook verso l'app con il segreto delle risposte; la risposta JSON finisce nei campi
 *    (data.esito → ACC_ESITO, data.risposta → ACC_RISPOSTA);
 * 3. se ACC_ESITO è ancora ATTESA il server è giù: testo di riserva; altrimenti, se il server ha
 *    mandato un testo, quello (codice, link personale, «troppo presto»…).
 * Nasce disattivata e senza trigger: il trigger sul pulsante si sceglie nell'editor di Spoki.
 */
export function corpoAutomazioneRisposta(pulsante, { ids, appUrl, inboundSecret }) {
  const esito = ids.campi.ACC_ESITO;
  const risposta = ids.campi.ACC_RISPOSTA;
  const payload = JSON.stringify({
    source: 'automation',
    phone: '{{ contact.phone }}',
    reply: pulsante.payload,
    code: '%%ACC_CODICE%%',
  });
  return {
    name: AUTOMAZIONI[pulsante.chiave],
    description: `Risponde al pulsante «${pulsante.testo}» del promemoria del giorno anche a server giù, poi avvisa l'app (docs/SPOKI.md).`,
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
 * all'ora della rete; se ACC_PROMEMORIA vale ancora DA_INVIARE manda il promemoria del giorno e lo
 * segna INVIATO. Nasce disattivata: si accende dopo la prova interna.
 */
export function corpoAutomazioneRete({ ids, ora }) {
  const promemoria = ids.campi.ACC_PROMEMORIA;
  const template = TEMPLATE.find((t) => t.tipo === 'REMINDER_SAME_DAY');
  return {
    name: AUTOMAZIONI.rete,
    description:
      "Manda il promemoria del giorno a chi non l'ha ricevuto dal server (ACC_PROMEMORIA = DA_INVIARE) (docs/SPOKI.md).",
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
