# Spoki: WhatsApp che regge anche a server giù

Questa pagina descrive cosa deve esistere nell'account Spoki perché i messaggi WhatsApp ai clienti
continuino a funzionare anche quando il server dell'officina non risponde, e come si configura. La
fonte unica di campi, testi e automazioni è [`scripts/spoki-spec.mjs`](../scripts/spoki-spec.mjs);
`npm run spoki:setup` la applica all'account via API REST, con la stessa chiave dell'app. Formati e
limiti vengono dalla documentazione API ufficiale di Spoki (collezione Postman, letta il 2026-09-24).

> **Demo interna.** Finché il committente non decide altrimenti i WhatsApp reali partono solo verso i
> numeri di `SPOKI_ALLOWED_RECIPIENTS`: con `SPOKI_PUBLIC_SENDS=false` (predefinito) ogni altro
> cliente resta in simulazione, anche con Spoki in `live` e il blocco di sicurezza tolto. Lo stesso
> vale per gli aggiornamenti dei contatti. Le automazioni create dallo script nascono **disattivate**.

## Chi fa cosa

| Momento                      | Server su                                                                                                                              | Server giù                                                                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Promemoria del giorno prima  | Lo manda l'app (template `acc_promemoria_giorno_prima`) e scrive sul contatto i campi `ACC_*`, con `ACC_PROMEMORIA = DA_INVIARE`       | Non parte: l'agenda di domani la conosce solo il server. Il giorno dopo il promemoria del mattino arriva comunque, se il server torna su in tempo |
| Promemoria del mattino       | Lo manda l'app alle `REMINDER_SAME_DAY_HOUR_LOCAL` (`ACC_PROMEMORIA = INVIATO`) e disarma chi non deve riceverlo (`NON_SERVE`)         | Lo manda la **rete di sicurezza** Spoki alle `SPOKI_SAFETY_NET_TIME` a chi ha ancora `DA_INVIARE`                                                 |
| Il cliente tocca un pulsante | L'automazione chiama l'app, che registra il fatto e restituisce il testo giusto (codice e link, «troppo presto», …); Spoki lo consegna | L'automazione manda il suo **testo di riserva**: il cliente ha comunque una risposta                                                              |
| Esiti di consegna            | Webhook V2 `message.outbound` → stato WhatsApp della pratica                                                                           | Si perdono gli esiti del fermo; la coda funziona lo stesso                                                                                        |

## 1. Campi del contatto

Spoki identifica i campi con un codice MAIUSCOLO e li richiama come `%%CODICE%%` in template,
automazioni e webhook. Il prefisso `ACC_` li separa dai campi che l'account usa per altro.

| Codice           | Tipo  | Chi lo scrive                              | Esempio                                |
| ---------------- | ----- | ------------------------------------------ | -------------------------------------- |
| `ACC_CODICE`     | testo | l'app, a ogni invio                        | `F041`                                 |
| `ACC_TARGA`      | testo | l'app, a ogni invio                        | `AB123CD`                              |
| `ACC_DATA`       | testo | l'app, a ogni invio                        | `24/09/2026`                           |
| `ACC_ORA`        | testo | l'app, a ogni invio                        | `09:30`                                |
| `ACC_GIORNO`     | data  | l'app, a ogni invio (AAAA-MM-GG)           | `2026-09-24`                           |
| `ACC_LINK`       | testo | l'app, a ogni invio (smart link personale) | `https://…/portal/<token>`             |
| `ACC_PROMEMORIA` | testo | l'app e la rete di sicurezza               | `DA_INVIARE` · `INVIATO` · `NON_SERVE` |
| `ACC_ESITO`      | testo | le automazioni dei pulsanti                | `ATTESA` finché il server non risponde |
| `ACC_RISPOSTA`   | testo | le automazioni dei pulsanti                | il testo preparato dal server          |

## 2. Template

Tutti in categoria **UTILITY** (comunicazioni di servizio su un appuntamento già preso), lingua
italiana. I testi sono gli stessi che l'app manda via SMS quando WhatsApp non arriva; Meta non
accetta un corpo che comincia o finisce con una variabile, per questo i messaggi con il link
finiscono con una frase.

| Template                      | Variabile con l'id                | Pulsanti rapidi                                   |
| ----------------------------- | --------------------------------- | ------------------------------------------------- |
| `acc_promemoria_giorno_prima` | `SPOKI_TEMPLATE_REMINDER_D1_ID`   | —                                                 |
| `acc_promemoria_giorno`       | `SPOKI_TEMPLATE_SAME_DAY_ID`      | «Sono arrivato», «In ritardo», «Non posso venire» |
| `acc_arrivo_confermato`       | `SPOKI_TEMPLATE_ARRIVED_REPLY_ID` | —                                                 |
| `acc_ritardo_confermato`      | `SPOKI_TEMPLATE_LATE_REPLY_ID`    | —                                                 |
| `acc_assenza_confermata`      | `SPOKI_TEMPLATE_ABSENT_REPLY_ID`  | —                                                 |
| `acc_arrivo_troppo_presto`    | `SPOKI_TEMPLATE_EARLY_REPLY_ID`   | —                                                 |
| `acc_accettazione_iniziata`   | `SPOKI_TEMPLATE_WELCOME_ID`       | —                                                 |
| `acc_accettazione_completata` | `SPOKI_TEMPLATE_COMPLETE_ID`      | —                                                 |

I testi completi sono in `scripts/spoki-spec.mjs`. Quando l'app manda il promemoria del giorno via
API allega ai tre pulsanti i payload `ACTION_ARRIVED`, `ACTION_LATE`, `ACTION_ABSENT`, che tornano
nel webhook `message.inbound`.

## 3. Automazioni

### 3.1 Le tre risposte ai pulsanti

`ACC · Risposta «Sono arrivato»`, `ACC · Risposta «In ritardo»`, `ACC · Risposta «Non posso venire»`.

**Trigger** (si sceglie nell'editor di Spoki: l'API non lo espone): _Messaggio del cliente → clic su
un pulsante di un template inviato_, template `acc_promemoria_giorno`, il pulsante corrispondente.

**Passi** (li crea lo script):

1. _Imposta campo_ `ACC_ESITO = ATTESA` e `ACC_RISPOSTA = -`.
2. _Webhook_ `POST <indirizzo pubblico>/api/v1/webhooks/spoki`, intestazioni
   `content-type: application/json` e `x-spoki-secret: <SPOKI_INBOUND_SECRET>`, corpo:
   ```json
   {
     "source": "automation",
     "phone": "{{ contact.phone }}",
     "reply": "ACTION_ARRIVED",
     "code": "%%ACC_CODICE%%"
   }
   ```
   (`ACTION_LATE` / `ACTION_ABSENT` nelle altre due). **Mappatura della risposta**: `data.esito` →
   `ACC_ESITO`, `data.risposta` → `ACC_RISPOSTA`.
3. _Se/altrimenti_ `ACC_ESITO` uguale a `ATTESA` (il server non ha risposto) → messaggio di
   riserva; altrimenti, se `ACC_RISPOSTA` è diverso da `-`, messaggio libero `%%ACC_RISPOSTA%%`.

La rotta dell'app registra il fatto (arrivo con la finestra di anticipo, ritardo, assenza che
diventa lead per il BDC) e risponde con `esito` (`ARRIVATO`, `TROPPO_PRESTO`, `GIA_REGISTRATO`,
`RITARDO`, `ASSENTE`, `NESSUNA_PRATICA`, `NON_RICONOSCIUTO`) e `risposta` (il testo per il cliente,
vuoto quando non c'è niente da dire). Una chiamata dell'automazione non fa mai partire un messaggio
dall'app.

**Testi di riserva** (server giù):

- Sono arrivato — «Grazie! Abbiamo ricevuto la sua conferma di arrivo per la vettura %%ACC_TARGA%%.
  Il suo codice è %%ACC_CODICE%%: si accomodi, la chiameremo con questo codice.»
- In ritardo — «Grazie per l'avviso! Abbiamo informato l'accettazione del suo ritardo. Quando arriva
  in officina avvisi il nostro personale.»
- Non posso venire — «Grazie per la comunicazione, abbiamo preso nota che oggi non potrà venire. Un
  nostro operatore la ricontatterà per fissare un nuovo appuntamento.»

Con le tre automazioni attive si mette `SPOKI_REPLIES_BY_AUTOMATION=true`: la stessa tocca che
arriva anche dal webhook V2 non fa partire una seconda conferma dall'app. Un messaggio scritto a
mano («sono in ritardo») resta all'app, perché nessuna automazione lo intercetta.

### 3.2 Rete di sicurezza del promemoria del mattino

`ACC · Rete di sicurezza promemoria del mattino`.

**Trigger**: condizione su campo data `ACC_GIORNO` = oggi, alle `SPOKI_SAFETY_NET_TIME` (es. 08:30,
dopo `REMINDER_SAME_DAY_HOUR_LOCAL`). **Passi**: _Se_ `ACC_PROMEMORIA` uguale a `DA_INVIARE` →
template `acc_promemoria_giorno` (variabili `%%ACC_ORA%%`, `%%ACC_TARGA%%`) e _Imposta campo_
`ACC_PROMEMORIA = INVIATO`.

L'app, quando c'è, fa in modo che la rete non raddoppi e non scriva a chi non deve: dopo il suo
promemoria scrive `NON_SERVE` su chi ha avuto il promemoria del giorno prima su WhatsApp ma non
quello di oggi (annullate, già arrivate, in carico, promemoria finito sull'SMS), e dalle
`SPOKI_SAFETY_NET_TIME` non manda più il promemoria del giorno, nemmeno rimettendosi in pari dopo un
riavvio.

## 4. Webhook V2 dell'account

Due webhook (Spoki ne vuole uno per evento, ognuno con il suo segreto `whsec_…`), entrambi verso
`<indirizzo pubblico>/api/v1/webhooks/spoki`:

- `message.outbound` — esiti di consegna (inviato, consegnato, letto, fallito);
- `message.inbound` — messaggi del cliente, compresi i tocchi sui pulsanti.

`SPOKI_WEBHOOK_SECRET` accetta i due segreti separati da virgola.

## 5. `npm run spoki:setup`

```bash
npm run spoki:setup
```

Di base **controlla soltanto**: elenca campi, template, automazioni (e con `--webhooks` i webhook)
e dice cosa c'è e cosa manca. Opzioni:

- `--apply` crea ciò che manca: campi, template **in bozza**, automazioni **disattivate**;
- `--submit` chiede a Meta l'approvazione dei template in bozza;
- `--app-url=https://…` indirizzo pubblico dell'app (predefinito `PUBLIC_BASE_URL`): serve alle
  automazioni dei pulsanti e ai webhook, e deve essere `https` raggiungibile da Spoki;
- `--webhooks` controlla (e con `--apply` crea) i due webhook V2;
- `--write-env` scrive in `.env.local` gli id dei template e i segreti dei webhook creati;
- `--safety-net-time=08:30` ora della rete (predefinito `SPOKI_SAFETY_NET_TIME`).

Non stampa mai chiave API né segreti, non tocca niente senza il prefisso `ACC`/`acc_` e non cancella
niente. Rispetta i limiti di Spoki (i campi personalizzati ammettono 5 chiamate al minuto: la prima
creazione richiede un paio di minuti).

## 6. Passi a mano

1. **Approvazione dei template** da parte di Meta: si segue in Spoki → Template.
2. **Trigger delle tre risposte**: nell'editor di ogni `ACC · Risposta …`, trigger _clic su un
   pulsante di un template_ sul pulsante giusto di `acc_promemoria_giorno`; controllare anche che
   la mappatura della risposta del webhook sia `data.esito → ACC_ESITO`, `data.risposta →
ACC_RISPOSTA`. Poi **Attiva**.
3. **Dopo la prova interna**: attivare la rete di sicurezza e impostare in `.env.local`
   `SPOKI_SAFETY_NET_TIME` (la stessa ora del trigger) e `SPOKI_REPLIES_BY_AUTOMATION=true`.

## 7. `.env.local` per la demo interna

```
SPOKI_ENABLED=true
SPOKI_PROVIDER=real
SPOKI_API_KEY=<chiave dell'account>
SPOKI_MODE=live
SPOKI_SAFETY_LOCK=false
SPOKI_ALLOWED_RECIPIENTS=<numeri interni, E.164, separati da virgola>
SPOKI_PUBLIC_SENDS=false
SPOKI_INBOUND_SECRET=<segreto delle risposte, almeno 16 caratteri>
SPOKI_WEBHOOK_SECRET=<whsec_… di message.inbound>,<whsec_… di message.outbound>
SPOKI_TEMPLATE_…_ID=<id dei template approvati>
SPOKI_REPLIES_BY_AUTOMATION=true
SPOKI_SAFETY_NET_TIME=08:30
PUBLIC_BASE_URL=https://<indirizzo pubblico dell'app>
```

Chiave e segreti si scrivono solo in `.env.local`, mai in chat o nei documenti.

## 8. Prova della demo interna

1. Una prenotazione di prova con il telefono di un numero interno.
2. Promemoria del giorno prima (Amministrazione › Sistema › Spoki, o `POST
/api/v1/system/cron/reminders?kind=previous-day`): arriva il messaggio; in Spoki il contatto ha i
   campi `ACC_*` e `ACC_PROMEMORIA = DA_INVIARE`.
3. Promemoria del mattino: arriva con i tre pulsanti; `ACC_PROMEMORIA = INVIATO`.
4. Tocco su ciascun pulsante con il server acceso: risposta con codice e link (o «troppo presto»),
   pratica aggiornata in dashboard, nessun doppio messaggio.
5. Server spento, tocco su un pulsante: arriva il testo di riserva.
6. Rete di sicurezza: server spento all'ora del promemoria, automazione attiva → il promemoria parte
   da Spoki all'ora della rete. Verificare qui il formato di `ACC_GIORNO` che il trigger a data
   accetta (l'app scrive AAAA-MM-GG).
7. Un numero **non** in `SPOKI_ALLOWED_RECIPIENTS`: nel registro del pannello Spoki compare «demo ·
   numero fuori lista» e al cliente non arriva niente.

## 9. Limiti noti

- Le risposte date durante un fermo del server non vengono registrate sulla pratica (l'automazione
  non riesce a chiamare l'app): restano nella chat di Spoki, e a fine giornata chi non si è
  presentato arriva comunque al CRM del BDC come assente.
- Il promemoria del giorno prima non ha rete di sicurezza: l'agenda di domani la conosce solo il
  server.
- Dove l'API di Spoki non documenta un dettaglio (formato del valore di un campo data per il
  trigger, forma della mappatura della risposta del webhook), lo script usa la forma più probabile e
  il punto va verificato nell'editor alla prima prova.
