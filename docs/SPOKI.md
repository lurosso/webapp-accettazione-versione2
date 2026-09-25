# Spoki: i WhatsApp dell'accettazione

Questa pagina dice quali template e campi dell'account Spoki usa l'app, cosa manca e come si
verifica. La fonte unica di campi, testi e automazioni è
[`scripts/spoki-spec.mjs`](../scripts/spoki-spec.mjs); `npm run spoki:setup` la confronta con
l'account via API REST, con la stessa chiave dell'app. Formati e limiti vengono dalla documentazione
API ufficiale di Spoki (collezione Postman, letta il 2026-09-24).

> **Regole del committente (2026-09-25)**
>
> - **Ciò che esiste nell'account non si modifica, mai**: né template, né campi, né automazioni, né
>   contatti. Si legge, si crea solo ciò che manca, e l'approvazione a Meta si chiede solo per i
>   template appena creati (di norma la chiede il committente). Lo script lo impone in codice
>   (`chiamataAmmessa`); con l'MCP si usano solo gli strumenti di lettura e di creazione.
> - **I template da usare sono quelli che iniziano con 📅**, fatti apposta per questo sistema e già
>   approvati. Le bozze `accettazione_*` e le automazioni «01 - Webhook Promemoria Domani» / «02 -
>   Webhook Promemoria Oggi» restano come sono e l'app non le usa.
> - **Demo interna**: i WhatsApp reali partono solo verso il numero di prova del committente
>   (`SPOKI_ALLOWED_RECIPIENTS`); con `SPOKI_PUBLIC_SENDS=false` ogni altro cliente resta in
>   simulazione, anche con Spoki in `live`.

## 1. Quale template per quale messaggio

| Messaggio dell'app                                                  | Template                        | Id     | Variabile                       |
| ------------------------------------------------------------------- | ------------------------------- | ------ | ------------------------------- |
| Promemoria del giorno prima                                         | 📅 Reminder 24h Appuntamento    | 454558 | `SPOKI_TEMPLATE_REMINDER_D1_ID` |
| Presa in carico                                                     | 📅 Conferma Accettazione        | 454762 | `SPOKI_TEMPLATE_WELCOME_ID`     |
| Conferma della prenotazione (inserimento manuale)                   | 📅 Conferma Prenotazione        | 454556 | `SPOKI_TEMPLATE_BOOKING_ID`     |
| Promemoria del mattino con «Sono arrivato / in ritardo / non vengo» | 📅 Promemoria Appuntamento Oggi | nuovo  | `SPOKI_TEMPLATE_SAME_DAY_ID`    |
| Risposte ai pulsanti (codice e link, ritardo, assenza, «presto»)    | nessuno: **messaggio libero**   | —      | —                               |
| Fine del check-in                                                   | nessuno: ripiega sull'SMS       | —      | `SPOKI_TEMPLATE_COMPLETE_ID`    |
| Vettura pronta                                                      | 📅 Notifica Pronto Vettura      | —      | non usato dall'app              |

Le risposte ai pulsanti non hanno bisogno di un template: il cliente ha appena toccato un pulsante,
quindi la finestra di 24 ore di WhatsApp è aperta e Spoki accetta un messaggio libero
(`type: "Message"`). Il testo lo prepara l'app, con codice, smart link personale o «è ancora un po'
presto».

## 2. I campi di ciascun template

Ogni template riceve **solo i suoi** campi, con i codici che l'account già usa. Un template **non
parte se uno dei suoi campi è vuoto** (Meta rifiuterebbe una variabile vuota, e un «📍 Sede:» vuoto
al cliente non va): il messaggio ripiega sull'SMS e il registro del pannello Spoki dice quale campo
manca.

| Campo                                | Da dove viene                                                                      | Reminder 24h | Conferma Accettazione | Conferma Prenotazione | Mattino |
| ------------------------------------ | ---------------------------------------------------------------------------------- | :----------: | :-------------------: | :-------------------: | :-----: |
| `NOME_CLIENTE`                       | nome e cognome della pratica (o la ragione sociale)                                |      ✓       |           ✓           |           ✓           |    ✓    |
| `DATA_PRENOTAZIONE`                  | giorno dell'appuntamento, GG/MM/AAAA                                               |      ✓       |                       |                       |         |
| `ORA_PRENOTAZIONE`                   | ora dell'appuntamento, HH:mm                                                       |      ✓       |                       |                       |    ✓    |
| `DATA` / `ORA`                       | giorno e ora dell'appuntamento                                                     |              |                       |           ✓           |         |
| `LUOGO`                              | `SPOKI_LUOGO` — **ancora da decidere**                                             |      ✓       |                       |           ✓           |         |
| `_MARCA_E_MODELLO_`                  | marca e modello del veicolo                                                        |      ✓       |           ✓           |           ✓           |    ✓    |
| `_TARGA_`                            | targa                                                                              |      ✓       |           ✓           |           ✓           |    ✓    |
| `_NOME_ACCETTATORE_`                 | chi ha preso in carico la pratica (altrimenti l'accettatore assegnato in Infinity) |              |           ✓           |                       |         |
| `_DATA_PREVISTA_` / `_ORA_PREVISTA_` | riconsegna prevista da Infinity (`data_prevcons`/`ora_prevcons`)                   |              |           ✓           |                       |         |

**Finché `SPOKI_LUOGO` è vuoto, il 📅 Reminder 24h e la 📅 Conferma Prenotazione non partono su
WhatsApp.** Il testo della sede lo indica il committente.

Con ogni template l'app manda i payload dei pulsanti: `ACTION_CONTACT` / `ACTION_CHANGE` per
«Contattaci» / «Modifica» dei 📅, `ACTION_ARRIVED` / `ACTION_LATE` / `ACTION_ABSENT` per il mattino.
Tornano nel webhook `message.inbound`: i primi due la coda li ignora (sono per le automazioni), gli
altri tre li registra.

## 3. Il template del mattino (da creare in bozza)

Nome «📅 Promemoria Appuntamento Oggi», categoria UTILITY, italiano, nello stile dei 📅. Intestazione
«Promemoria Appuntamento Oggi»; corpo con `%%NOME_CLIENTE%%`, `%%ORA_PRENOTAZIONE%%`,
`%%_MARCA_E_MODELLO_%%`, `%%_TARGA_%%` e la firma «_Il Team Autoclub_»; tre pulsanti rapidi «Sono
arrivato», «Sono in ritardo», «Non posso venire». Il testo esatto è in `scripts/spoki-spec.mjs`.
Si crea in bozza con `npm run spoki:setup -- --apply`; l'approvazione a Meta la chiede il committente
da Spoki.

## 4. Automazioni (da decidere)

Nessuna automazione è stata creata. Sono pronte nella specifica, per quando il committente lo dirà:

- **«Contattaci» e «Modifica» dei 📅** — cosa devono fare è da definire (per esempio: risposta al
  cliente, nota o ticket per il personale, lead al BDC per «Modifica»).
- **Risposte ai pulsanti del mattino a server giù** (`ACC · Risposta …`): l'automazione chiama
  l'app dal suo passo «webhook» (`source: "automation"`, intestazione `x-spoki-secret`), consegna il
  testo che l'app restituisce (`data.risposta`) o, se l'app non risponde, un testo di riserva.
  Richiedono l'indirizzo https pubblico dell'app e i campi `ACC_ESITO`, `ACC_RISPOSTA`.
- **Rete di sicurezza del mattino**: trigger sulla data `ACC_GIORNO` all'ora
  `SPOKI_SAFETY_NET_TIME`, manda il promemoria del mattino a chi ha ancora `ACC_PROMEMORIA =
DA_INVIARE`. Richiede i campi `ACC_GIORNO` e `ACC_PROMEMORIA` (l'app li scrive solo con la rete
  accesa).

I campi `ACC_*` non esistono nell'account e si creano solo insieme alle automazioni
(`--automazioni`). Il trigger «clic su un pulsante di un template» non è nell'API: si sceglie
nell'editor di Spoki.

## 5. Webhook V2 dell'account

Due webhook (Spoki ne vuole uno per evento, ognuno con il suo segreto `whsec_…`), entrambi verso
`<indirizzo pubblico>/api/v1/webhooks/spoki`: `message.outbound` (esiti di consegna) e
`message.inbound` (messaggi del cliente e tocchi sui pulsanti). `SPOKI_WEBHOOK_SECRET` accetta i due
segreti separati da virgola. Anche questi aspettano l'indirizzo https pubblico.

## 6. `npm run spoki:setup`

```bash
npm run spoki:setup
```

Di base **controlla soltanto**: i template 📅 ci sono e sono approvati? i campi ci sono? il
template del mattino esiste già? Opzioni:

- `--apply` crea ciò che manca: il template del mattino **in bozza** (ed eventuali campi mancanti);
- `--submit` chiede a Meta l'approvazione dei soli template appena creati;
- `--automazioni` include campi `ACC_*` e automazioni (con `--apply` li crea, disattivate);
- `--app-url=https://…` indirizzo pubblico dell'app (predefinito `PUBLIC_BASE_URL`);
- `--webhooks` controlla (e con `--apply` crea) i due webhook V2;
- `--write-env` scrive in `.env.local` gli id dei template e i segreti dei webhook creati.

Non stampa mai chiave API né segreti e non modifica né cancella niente di ciò che esiste: ogni
chiamata che non sia una lettura, una creazione o l'approvazione di un template appena creato viene
fermata prima di partire. Con più template dallo stesso nome sceglie quello approvato e lo dice.

### Con l'MCP di Spoki

L'MCP ufficiale (`https://mcp.spoki.com/v2/mcp`, intestazione `X-Spoki-Api-Key`, chiave da
_app.spoki.it → Integrazioni → Spoki MCP → Request Api Key_) crea **template** e **campi
personalizzati** e sa elencare, attivare, disattivare e avviare le automazioni, ma **non le crea**:
per quelle resta l'API REST (`POST /api/1/automations/`), con la stessa intestazione. Con l'MCP si
usano solo `get_*`, `create_template`, `create_custom_field` e, a richiesta, `submit_template` sui
template appena creati; mai `update_*` né `delete_*`, e `trigger_automation` solo verso il numero di
prova.

## 7. `.env.local`

```
SPOKI_ENABLED=true
SPOKI_PROVIDER=real
SPOKI_API_KEY=<chiave dell'account>
SPOKI_MODE=live
SPOKI_SAFETY_LOCK=false
SPOKI_ALLOWED_RECIPIENTS=<numero di prova del committente, E.164>
SPOKI_PUBLIC_SENDS=false
SPOKI_TEMPLATE_REMINDER_D1_ID=454558
SPOKI_TEMPLATE_WELCOME_ID=454762
SPOKI_TEMPLATE_BOOKING_ID=454556
SPOKI_TEMPLATE_SAME_DAY_ID=<id del template del mattino, quando approvato>
SPOKI_LUOGO=<sede, da decidere>
```

Più avanti, con l'indirizzo https pubblico: `PUBLIC_BASE_URL`, `SPOKI_WEBHOOK_SECRET`,
`SPOKI_INBOUND_SECRET`, e per le automazioni `SPOKI_REPLIES_BY_AUTOMATION` e `SPOKI_SAFETY_NET_TIME`.
Chiave e segreti si scrivono solo in `.env.local`, mai in chat o nei documenti.

## 8. Prova della demo interna (quando si accende)

1. Una prenotazione di prova con il numero di prova.
2. Presa in carico: arriva la 📅 Conferma Accettazione con accettatore, marca e modello, targa e
   riconsegna prevista.
3. Promemoria del giorno prima e conferma prenotazione: partono solo con `SPOKI_LUOGO` impostato;
   senza, il registro del pannello dice «campi del template vuoti (LUOGO)».
4. Promemoria del mattino (dopo l'approvazione): tre pulsanti; ogni tocco aggiorna la pratica e
   riceve la risposta come messaggio libero.
5. Un numero diverso da quello di prova: nel registro compare «demo · numero fuori lista» e non
   arriva niente.

## 9. Limiti noti

- Senza indirizzo https pubblico Spoki non può chiamare l'app: niente esiti di consegna né tocchi
  sui pulsanti registrati in automatico finché non c'è.
- Il promemoria del giorno prima non ha rete di sicurezza: l'agenda di domani la conosce solo il
  server.
- Dove l'API di Spoki non documenta un dettaglio (formato di un campo data per il trigger, forma
  della mappatura della risposta del webhook), la specifica usa la forma più probabile e il punto va
  verificato nell'editor alla prima prova.
