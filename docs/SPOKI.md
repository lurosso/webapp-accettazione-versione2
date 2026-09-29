# Spoki: i WhatsApp dell'accettazione

> **Perimetro (2026-09-25).** L'app manda ai clienti **solo i promemoria** (giorno prima e mattino) e
> gestisce **la conferma del cliente** (i pulsanti del mattino e le risposte). Tutto il resto — conferme
> di prenotazione e di accettazione, vettura pronta, «Contattaci» / «Modifica» — non è compito
> dell'app: i messaggi a evento sono spenti (`MESSAGING_TRIGGERS_ENABLED=false`).

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

| Messaggio dell'app                                                  | Template                        | Id                 | Variabile                       |
| ------------------------------------------------------------------- | ------------------------------- | ------------------ | ------------------------------- |
| Promemoria del giorno prima                                         | 📅 Reminder 24h Appuntamento    | 454558 (approvato) | `SPOKI_TEMPLATE_REMINDER_D1_ID` |
| Promemoria del mattino con «Sono arrivato / in ritardo / non vengo» | 📅 Promemoria Appuntamento Oggi | 508848 (approvato) | `SPOKI_URL_REMINDER_SAME_DAY`   |
| Risposte ai pulsanti (codice e link, ritardo, assenza, «presto»)    | nessuno: **messaggio libero**   | —                  | —                               |

Gli altri 📅 (Conferma Accettazione, Conferma Prenotazione, Notifica Pronto Vettura) restano
nell'account e l'app non li usa.

Le risposte ai pulsanti non hanno bisogno di un template: il cliente ha appena toccato un pulsante,
quindi la finestra di 24 ore di WhatsApp è aperta e Spoki accetta un messaggio libero
(`type: "Message"`). Il testo lo prepara l'app, con codice, smart link personale o «è ancora un po'
presto».

## 2. I campi di ciascun template

Ogni template riceve **solo i suoi** campi, con i codici che l'account già usa. Un template **non
parte se uno dei suoi campi è vuoto** (Meta rifiuterebbe una variabile vuota, e un «📍 Sede:» vuoto
al cliente non va): il messaggio ripiega sull'SMS e il registro del pannello Spoki dice quale campo
manca.

| Campo               | Da dove viene                                       | Reminder 24h | Mattino |
| ------------------- | --------------------------------------------------- | :----------: | :-----: |
| `NOME_CLIENTE`      | nome e cognome della pratica (o la ragione sociale) |      ✓       |    ✓    |
| `DATA_PRENOTAZIONE` | giorno dell'appuntamento, GG/MM/AAAA                |      ✓       |         |
| `ORA_PRENOTAZIONE`  | ora dell'appuntamento, HH:mm                        |      ✓       |    ✓    |
| `LUOGO`             | `SPOKI_LUOGO` («Via Napoli 364 B2/B3, Bari»)        |      ✓       |         |
| `_MARCA_E_MODELLO_` | marca e modello del veicolo                         |      ✓       |    ✓    |
| `_TARGA_`           | targa                                               |      ✓       |    ✓    |

**La sede riguarda proprio il nostro promemoria del giorno prima**: il 📅 Reminder 24h scrive
«📍 _Sede:_ …». Finché `SPOKI_LUOGO` è vuoto quel promemoria non parte su WhatsApp. In Infinity le
prenotazioni dell'accettazione (tipo `PR01`, «Prenotazione/Preventivo officina Bari») sono della
sede `01` · Bari, via Napoli 364 B2/B3 (tabella `sedi`): il committente ha confermato il
2026-09-28 `SPOKI_LUOGO="Via Napoli 364 B2/B3, Bari"`.

Con il Reminder 24h l'app manda anche i payload dei suoi pulsanti, `ACTION_CONTACT` / `ACTION_CHANGE`
(«Contattaci» / «Modifica»), che la coda ignora; con il template del mattino `ACTION_ARRIVED` /
`ACTION_LATE` / `ACTION_ABSENT`, che la coda registra quando tornano nel webhook `message.inbound`
(con l'https) o, finché non c'è, dal campo `ACC_PULSANTE` (§4).

## 3. Il template del mattino

Nome «📅 Promemoria Appuntamento Oggi», categoria di servizio (in Spoki «TRANSACTIONAL», come i 📅), italiano, nello stile dei 📅. Intestazione
«Promemoria Appuntamento Oggi»; corpo con `%%NOME_CLIENTE%%`, `%%ORA_PRENOTAZIONE%%`,
`%%_MARCA_E_MODELLO_%%`, `%%_TARGA_%%` e la firma «_Il Team Autoclub_»; tre pulsanti rapidi «Sono
arrivato», «Sono in ritardo», «Non posso venire». Il testo esatto è in `scripts/spoki-spec.mjs`.
Creato il 2026-09-25 con `npm run spoki:setup -- --apply`: id **508848**. Inviato a Meta per
l'approvazione il 2026-09-28, su richiesta del committente, e approvato lo stesso giorno. Spoki ha collegato da solo ognuno dei tre
pulsanti all'automazione con lo stesso testo (§4).

## 4. Automazioni e lettura dei tocchi (senza https)

Senza indirizzo https pubblico Spoki non può chiamare l'app. Il tocco su un pulsante del mattino
passa allora da un campo del contatto: **Spoki lo scrive, l'app lo legge**. Al cliente scrive solo
l'app: le automazioni non mandano messaggi. «Contattaci» e «Modifica» dei 📅 **non sono compito
dell'app**.

**Il promemoria del mattino parte da un'automazione chiamata via API** (richiesta del committente,
2026-09-28): «ACC · Promemoria del mattino (API)», id **571227**, trigger «API». L'app la chiama con
`SPOKI_URL_REMINDER_SAME_DAY` e `SPOKI_SECRET_REMINDER_SAME_DAY` (e senza
`SPOKI_TEMPLATE_SAME_DAY_ID`, che altrimenti vince), mandando nel corpo numero, nome e i campi del
template (`NOME_CLIENTE`, `ORA_PRENOTAZIONE`, `_MARCA_E_MODELLO_`, `_TARGA_`) più
`ACC_PROMEMORIA = INVIATO` e `ACC_PULSANTE = ATTESA`. Ha un solo passo: il template 508848.

Le **funzioni dei pulsanti** non possono stare in questa automazione: Spoki non dà rami a un passo
«invia template» (lo dice l'API: «non è un passo ramificabile»; i rami li hanno solo Se/Altrimenti,
Switch e Voice). Il 2026-09-28 ci si è provato con «attendi la risposta» + uno Switch sul messaggio
ricevuto: prende solo il **primo** tocco (chi tocca «Sono in ritardo» e poi «Sono arrivato» perde il
secondo), tiene il contatto «in corso» per ore e, insieme alle automazioni dei pulsanti, registra
lo stesso tocco due volte. Tolto il 2026-09-29. Ogni tocco lo prende l'automazione del suo pulsante
(sotto), che Spoki ha collegato al pulsante del template: è il modo di Spoki di dare una funzione a
un pulsante, a ogni tocco.

Nasce disattivata: la attiva il committente da Spoki, insieme alle tre dei pulsanti.

**Nell'account** (creati il 2026-09-28 con l'MCP di Spoki; niente di esistente è stato toccato):

| Oggetto                             | Id     | Cosa fa                                                                             |
| ----------------------------------- | ------ | ----------------------------------------------------------------------------------- |
| campo `ACC_PROMEMORIA` (testo)      | 332239 | `INVIATO` = il cliente ha avuto il promemoria del mattino dall'app                  |
| campo `ACC_PULSANTE` (testo)        | 332240 | il pulsante toccato: `ARRIVATO`, `RITARDO`, `ASSENTE`; `ATTESA` = niente da leggere |
| campo `ACC_GIORNO` (data)           | 332241 | per la rete di sicurezza, non ancora creata                                         |
| «ACC · Pulsante «Sono arrivato»»    | 570921 | se `ACC_PROMEMORIA = INVIATO` → `ACC_PULSANTE = ARRIVATO`                           |
| «ACC · Pulsante «Sono in ritardo»»  | 570922 | se `ACC_PROMEMORIA = INVIATO` → `ACC_PULSANTE = RITARDO`                            |
| «ACC · Pulsante «Non posso venire»» | 570923 | se `ACC_PROMEMORIA = INVIATO` → `ACC_PULSANTE = ASSENTE`                            |

Il trigger di ogni automazione è **«messaggio del cliente»** con il testo del pulsante. In Spoki è
un _widget_, e l'elenco delle automazioni lo mostra come «QR Code 1/2/3»: è il nome che Spoki dà al
widget, non vuol dire che serva un QR. Spoki ha collegato da solo ogni pulsante del template 508848
al widget con lo stesso testo (`triggered_widget`), quindi il tocco fa partire l'automazione giusta.
Lo fa anche chi scrive a mano le stesse parole; per chi non ha avuto il promemoria dall'app la
condizione su `ACC_PROMEMORIA` ferma tutto. Tre automazioni piccole invece di una: ognuna sa quale
pulsante è stato toccato senza dover leggere il testo del messaggio, cosa che l'API non documenta.
Prova del committente, 2026-09-28: «Non posso venire» scritto dal suo telefono → `ACC_PULSANTE =
ASSENTE` sul suo contatto. **Da attivare dal committente**: «Sono arrivato» e «Sono in ritardo»
(Automazioni → interruttore); «Non posso venire» è già attiva. L'API REST non crea il trigger
«messaggio del cliente»: in un altro account si creano con l'MCP di Spoki o dall'editor.

**Nell'app** (`SpokiReplyPoller`, `SPOKI_REPLY_POLLING=true`):

1. il promemoria del mattino scrive sul contatto `ACC_PROMEMORIA = INVIATO` e anche
   `ACC_PULSANTE = ATTESA`, così un tocco di un altro giorno non vale per oggi;
2. ogni `SPOKI_REPLY_POLL_SECONDS` (20) l'app legge `ACC_PULSANTE` con
   `GET /api/1/contacts/?phone=`, solo per le pratiche di oggi in coda, non ancora arrivate, con il
   promemoria del mattino arrivato davvero su WhatsApp (non fermato dal guardrail); a rotazione,
   dentro un budget di 60 chiamate al minuto, metà delle 120 che Spoki concede (20 a passata con
   20 s, 10 con 10 s, mai più di 20), e al primo «troppe richieste» la passata si ferma;
3. un tocco passa da `WhatsAppInboundService` come dal webhook (arrivo con codice e link, ritardo,
   assenza, «troppo presto»), e al cliente risponde l'app con un messaggio libero. Con più auto
   sullo stesso numero va alla prima in coda non ancora arrivata;
4. l'app rilegge il campo e lo rimette ad `ATTESA` solo se vale ancora quel tocco: se nel frattempo
   il cliente ne ha toccato un altro, lo applica la passata dopo. `contacts/sync` lascia com'erano
   nome, cognome ed e-mail del contatto (verificato il 2026-09-28). Se la scrittura non riesce, le
   passate dopo riprovano ad azzerare, anche per le pratiche non più da guardare, senza riapplicare
   il tocco.

Letture e scritture hanno gli stessi blocchi degli invii: in simulazione non parte niente, in demo
si leggono solo i numeri di `SPOKI_ALLOWED_RECIPIENTS`. Il pannello Spoki mostra «tocchi letti da
Spoki ogni 20 s» e com'è andata l'ultima passata (letti, fermati, non riusciti, ultimo errore con
l'ora). La lettura non parte con `MESSAGING_STANDBY=true`. Di solito il tocco arriva in coda entro
una passata; con più contatti di quanti ne stanno in una passata, entro qualche passata. A server
spento il tocco resta nel campo, e l'app lo applica (e risponde) quando riparte, se la pratica è
ancora in coda. La lettura va accesa prima del promemoria del mattino: un promemoria partito con la
lettura spenta non ha rimesso `ACC_PULSANTE` ad `ATTESA`.

**Non creata: la rete di sicurezza del mattino** (trigger sulla data `ACC_GIORNO` all'ora
`SPOKI_SAFETY_NET_TIME`, manda il promemoria del mattino a chi ha ancora `ACC_PROMEMORIA =
DA_INVIARE`). È Spoki a scrivere al cliente, quindi serve il sì esplicito del committente; la
specifica è pronta (`corpoAutomazioneRete`, che rimette anche `ACC_PULSANTE` ad `ATTESA`) e si
crea solo con `npm run spoki:setup -- --automazioni --apply --rete`. Se un giorno si accende, la
lettura dei tocchi andrà estesa alle pratiche il cui promemoria l'ha mandato la rete. Il vecchio
disegno «l'automazione chiama l'app e risponde lei» (`ACC_ESITO`, `ACC_RISPOSTA`,
`SPOKI_REPLIES_BY_AUTOMATION`, da lasciare `false`) non si usa più.

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
- `--automazioni` controlla i campi `ACC_*` e le automazioni (quelle dei pulsanti: ci sono? sono
  attive?); con `--apply` crea i campi mancanti, mai le automazioni dei pulsanti, il cui trigger non
  è nell'API;
- `--rete` (con `--automazioni --apply` e l'ora in `SPOKI_SAFETY_NET_TIME` o
  `--safety-net-time=HH:mm`) crea la rete di sicurezza, disattivata: solo con il sì del
  committente;
- `--app-url=https://…` indirizzo pubblico dell'app (predefinito `PUBLIC_BASE_URL`);
- `--webhooks` controlla (e con `--apply` crea) i due webhook V2;
- `--write-env` scrive in `.env.local` gli id dei template e i segreti dei webhook creati.

Non stampa mai chiave API né segreti e non modifica né cancella niente di ciò che esiste: ogni
chiamata che non sia una lettura, una creazione o l'approvazione di un template appena creato viene
fermata prima di partire. Con più template dallo stesso nome sceglie quello approvato e lo dice.

### Con l'MCP di Spoki

L'MCP ufficiale (`https://mcp.spoki.com/v2/mcp`, intestazione `X-Spoki-Api-Key`, chiave da
_app.spoki.it → Integrazioni → Spoki MCP → Request Api Key_) crea **template**, **campi
personalizzati** e **automazioni**, anche con il trigger «messaggio del cliente» che l'API REST non
espone: le tre «ACC · Pulsante …» sono state create così il 2026-09-28 (`create_empty_automation`,
`add_customer_message_trigger`, ripetuto con l'id del widget perché il primo giro lo crea senza
collegarlo, `add_step` con `ifelse` e `customfield`). Con l'MCP si usano solo `get_*`,
`search_*`, le creazioni di oggetti nuovi e, a richiesta, `submit_template` sui template appena
creati; si modifica solo ciò che si è appena creato, mai ciò che c'era, e `trigger_automation` solo
verso il numero di prova. L'attivazione delle automazioni la fa il committente da Spoki.

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
SPOKI_URL_REMINDER_SAME_DAY=<indirizzo del trigger API dell'automazione 571227>
SPOKI_SECRET_REMINDER_SAME_DAY=<segreto del trigger API>
SPOKI_LUOGO="Via Napoli 364 B2/B3, Bari"
SPOKI_REPLY_POLLING=true
SPOKI_REPLY_POLL_SECONDS=20
MESSAGING_TRIGGERS_ENABLED=false
```

Più avanti, con l'indirizzo https pubblico: `PUBLIC_BASE_URL` e `SPOKI_WEBHOOK_SECRET` (esiti di
consegna e tocchi in tempo reale); con il sì del committente `SPOKI_SAFETY_NET_TIME` per la rete.
Chiave e segreti si scrivono solo in `.env.local`, mai in chat o nei documenti.

## 8. Prova della demo interna (quando si accende)

1. Una prenotazione di prova con il numero di prova.
2. Promemoria del giorno prima: parte solo con `SPOKI_LUOGO` impostato; senza, il registro del
   pannello dice «campi del template vuoti (LUOGO)».
3. Promemoria del mattino: tre pulsanti; ogni tocco, di solito entro una passata (20 s), aggiorna
   la pratica in coda e riceve la risposta come messaggio libero.
4. Solo le automazioni, senza il template: con `ACC_PROMEMORIA = INVIATO` sul contatto di prova,
   scrivere dal telefono di prova «Non posso venire» (o provarlo nella simulazione di Spoki) →
   `ACC_PULSANTE = ASSENTE` nei «Campi Dinamici» del contatto.
5. Un numero diverso da quello di prova: nel registro compare «demo · numero fuori lista» e non
   arriva niente; i suoi campi non vengono nemmeno letti.

## 9. Limiti noti

- Senza indirizzo https pubblico Spoki non può chiamare l'app: niente esiti di consegna (il
  messaggio resta «inviato»), e i tocchi sui pulsanti arrivano con la lettura periodica, fino a
  `SPOKI_REPLY_POLL_SECONDS` dopo il tocco.
- Due tocchi fra una lettura e l'altra: vale l'ultimo (il campo ne tiene uno solo).
- Il promemoria del giorno prima non ha rete di sicurezza: l'agenda di domani la conosce solo il
  server.
- Dove l'API di Spoki non documenta un dettaglio (formato di un campo data per il trigger della
  rete di sicurezza), la specifica usa la forma più probabile e il punto va verificato nell'editor
  alla prima prova.
