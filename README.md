# AutoClub · Web App Accettazione e Flussi Officina

Sistema web per la gestione dell'accoglienza dei veicoli in officina: elimina la gestione cartacea,
riduce le attese e rende trasparente lo stato della pratica a operatori e clienti.

> Stato del progetto: **in sviluppo**. Sono funzionanti con dati simulati la dashboard di
> accettazione con vista multi-sportello e il portale cliente raggiungibile da QR code. Tutti i
> sistemi aziendali (Infinity, Spoki, SMS Hosting, CRM) sono disaccoppiati tramite interfacce e
> oggi rispondono con implementazioni **Mock** deterministiche. Nessun dato reale viene letto o
> scritto.

## Indice

- [Cosa fa](#cosa-fa)
- [Architettura Mock-First](#architettura-mock-first)
- [Avvio rapido](#avvio-rapido)
- [Account dimostrativi](#account-dimostrativi)
- [Le dashboard](#le-dashboard)
- [Script disponibili](#script-disponibili)
- [Struttura del repository](#struttura-del-repository)
- [Documentazione](#documentazione)

## Cosa fa

Ogni mattina alle 06:00 il sistema acquisisce l'agenda degli appuntamenti dal DMS **Infinity**,
assegna a ogni pratica un codice progressivo univoco (`F001`, `F002`, …) in ordine di prenotazione e
la mette in coda. Gli accettatori lavorano su una dashboard monopagina con tre azioni rapide:

| Azione                | Stato risultante            | Effetto                                              |
| --------------------- | --------------------------- | ---------------------------------------------------- |
| **Prendi in carico**  | In carico (evidenza gialla) | Assegna l'operatore e una postazione di accettazione libera |
| **Salta**             | Saltata                     | Pospone la pratica lasciandola al proprio orario     |
| **Completato**        | Completata (evidenza verde) | Libera l'accettazione; la pratica esce dalla vista attiva |

Chi era atteso da più di dieci minuti e non è ancora stato preso in carico finisce nel blocco
**In ritardo / assenti**, dove l'accettatore lo rimette in coda quando arriva, oppure lo segnala
assente perché il BDC lo ricontatti.

Il **portale cliente** completa il quadro: chi entra in officina inquadra il QR code della corsia,
digita la targa e vede il proprio codice, quanti clienti ha davanti e cosa deve fare, con la pagina
che si aggiorna da sola mentre l'operatore lavora. Sopra ogni postazione un **monitor** mostra il
codice in lavorazione e, appena l'accettatore chiude la pratica, invita il cliente successivo ad
avanzare. Le **comunicazioni** partono da sole dopo la sincronizzazione dell'agenda, con WhatsApp
via Spoki e ripiego automatico su SMS. Dal **tablet** l'accettatore fa il giro della vettura,
scatta le foto, annota i danni e chiude il check-in: note e foto finiscono nel fascicolo della
pratica, si rivedono dalla dashboard e arrivano al CRM. Chi non si presenta finisce nel **cruscotto
BDC**, dove il back office lo richiama e chiude il lead. Restano da sviluppare il registro degli
invii, i video e la vista tecnica degli eventi CRM. La priorità di sviluppo è definita in [`CLAUDE.md`](CLAUDE.md); i
requisiti completi sono in [`docs/ANALISI_REQUISITI.md`](docs/ANALISI_REQUISITI.md).

## Identità visiva

I colori dell'interfaccia sono quelli del marchio: blu istituzionale `#0065A0`, verde `#87BD22`,
grigi `#2E2E2E` e `#F2F2F2`, presi dalle variabili CSS pubblicate da
[autoclubgroup.it](https://www.autoclubgroup.it/). Stanno in `src/app/globals.css` come token
`--color-brand-*`, insieme alla scala neutra ritinta sul blu: cambiando quei valori cambia tutta
l'applicazione. I colori di stato della coda (in attesa, in carico, completata, assente) restano
invece indipendenti dal marchio, perché comunicano un'informazione e non uno stile.

Il marchio a schermo (`BrandMark`) è scritto in CSS, non è un file immagine: resta nitido sui
monitor appesi in officina e non aggiunge nulla da caricare. Quando ci verrà fornito il logo
ufficiale basterà sostituire quel componente.

## Architettura Mock-First

Il sistema è costruito **prima dei sistemi aziendali**, non dopo. Tutto ciò che è esterno sta dietro
una porta (interfaccia TypeScript) e ha oggi una sola implementazione: un Mock che genera dati
realistici e deterministici o scrive log in console.

```
UI / Dashboard ─► Casi d'uso ─► Interfacce (porte) ◄─ Mock (oggi)   ◄─ selezionati dal
(src/app,           (src/application)   IInfinityService     InfinityServiceMock     container in base
 src/modules)                            ISpokiService        SpokiServiceMock        alle variabili
                                         ISmsHostingService   SmsHostingServiceMock   d'ambiente
                                         ICrmService          CrmServiceMock          (SERVICES_PROVIDER)
                                         I*Repository         InMemory*Repository  ◄─ Reale (domani)
```

- **Infinity** (agenda del DMS): `IInfinityService` → `InfinityServiceMock` produce ogni giorno la
  stessa agenda a partire da un seme, con targhe, nomi e orari italiani realistici.
- **Spoki** (WhatsApp) e **SMS Hosting** (SMS di ripiego): `ISpokiService` / `ISmsHostingService` →
  i mock decidono l'esito dall'ultima cifra del telefono, così la catena WhatsApp → SMS → contatto
  manuale è verificabile senza inviare nulla a nessuno. Le cifre: da 0 a 6 WhatsApp consegnato,
  7 non consegnabile e 9 rifiutato (in entrambi i casi parte l'SMS), 8 errore temporaneo su
  entrambi i canali, 99 nessun canale disponibile e serve una telefonata. Dopo la sincronizzazione
  dell'agenda i promemoria partono da soli e l'esito compare in dashboard accanto al cliente.
- **CRM / BDC**: `ICrmService` → `CrmServiceMock` registra i webhook di no-show.
- **Persistenza**: repository in memoria condivisi da tutte le postazioni (un solo processo Node),
  sostituibili da Prisma senza toccare i casi d'uso.

Solo tre file conoscono le implementazioni concrete (`src/services/factory.ts`,
`src/repositories/factory.ts`, `src/config/container.ts`); una regola ESLint impedisce a UI e casi
d'uso di importare mock o repository direttamente. Sostituire un mock con il servizio reale significa
scrivere un adapter che implementa la stessa interfaccia e cambiare una variabile d'ambiente: la
dashboard non cambia. Il dettaglio è in [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Avvio rapido

Prerequisiti: **Node.js 22 o superiore** (sviluppato con Node 24) e **npm**.

```bash
npm install
```

```bash
npm run dev
```

Apri <http://localhost:3000>: vieni reindirizzato alla pagina di login. Non serve alcuna
configurazione: senza file `.env.local` l'app parte interamente in modalità mock. Per personalizzare
(fuso orario, ora della sync, comportamento dei mock) copia [`.env.example`](.env.example) in
`.env.local`.

All'avvio il server costruisce il container e, se l'ora locale ha superato le 06:00, esegue subito la
sincronizzazione dell'agenda: la coda della giornata è già popolata al primo accesso.

## Account dimostrativi

Password unica per tutti: `demo`. Gli account sono definiti nel seed (`src/config/seed.ts`) e il
container **rifiuta di avviarsi** con queste credenziali se un provider è impostato su `real` o se
`NODE_ENV=production`.

| Utente          | Ruolo          | Sportello abituale                   |
| --------------- | -------------- | ------------------------------------ |
| `admin`         | Amministratore | tutti                                |
| `responsabile`  | Responsabile   | tutti                                |
| `mario.rossi`   | Accettatore    | S1 · Stellantis Italia (Fiat, Lancia)|
| `laura.bianchi` | Accettatore    | S2 · Jeep / Alfa Romeo               |
| `andrea.conti`  | Accettatore    | S3 · Peugeot / Citroën / Opel        |

Al login si scelgono **Sportello / Brand** e **Postazione** (P1–P4, ognuna con un'accettazione
predefinita): determinano il filtro iniziale della coda e l'accettazione proposta alla presa in carico.

## Le dashboard

| Percorso              | Destinatario   | Stato          | Contenuto                                                                                 |
| --------------------- | -------------- | -------------- | ----------------------------------------------------------------------------------------- |
| `/login`              | Accettatore    | disponibile    | Credenziali, scelta sportello/brand e postazione                                          |
| `/accettazione`       | Accettatore    | disponibile    | Coda ordinata per orario con codici F001…, azioni rapide, blocco **In ritardo / assenti**, banner sync, **vista globale** per prendere in carico pratiche di altri sportelli, aggiornamento ogni 3 s; il clic su una riga apre i dati del cliente |
| `/sistema`            | Responsabile / IT | disponibile | Stato delle porte esterne (Infinity, Spoki, SMS Hosting, CRM) e, per gli amministratori, la coda di uscita verso il CRM con "Forza riprova" |
| `/cliente` (`/qr`)    | Cliente (QR)   | disponibile    | Ricerca per targa e stato del turno in tempo reale: codice, clienti in attesa, messaggio per stato; nessuna autenticazione e nessun dato personale |
| `/display/sala-attesa` | Sala d'attesa | disponibile    | Tabellone stile ufficio pubblico: codici chiamati con l'accettazione a cui presentarsi e prossimi turni |
| `/manager`            | BDC / Responsabile | disponibile | Cruscotto del back office: clienti segnati assenti da ricontattare, con telefono richiamabile e chiusura del lead con esito; da qui si esegue anche la chiusura di giornata |
| `/comunicazioni`      | Responsabile   | pianificato    | Registro degli invii WhatsApp e SMS con conferma manuale (l'invio automatico funziona già) |
| `/display/1` … `/4`   | Monitor        | disponibile    | Schermo a tutto campo per i monitor sopra le postazioni: codice e targa in servizio, oppure invito verde ad avanzare; si aggiorna ogni 2 secondi |
| `/tablet`             | Tablet         | disponibile    | Accettazione al veicolo: le pratiche del proprio sportello in due schede grandi, check-in a tutto schermo con fotocamera e note sui danni rilevati |

API principali (JSON, autenticate via cookie di sessione): `GET /api/v1/queue`,
`POST /api/v1/appointments/{id}/actions`, `POST /api/v1/appointments/{id}/media` (foto, multipart),
`POST /api/v1/appointments/{id}/check-in`, `POST /api/v1/sync`, `POST /api/v1/auth/login`,
`GET /api/v1/crm/leads` e `POST /api/v1/crm/leads/{id}/contacted` (responsabile e amministratore),
`POST /api/v1/system/close-day` (chiusura giornata), `GET /api/v1/crm/outbox` e
`POST /api/v1/crm/outbox/{id}/retry` (amministratore).
Pubbliche, senza sessione: `GET /api/v1/public/status?targa=AB123CD` (stato del turno, protetta da
limiti di frequenza) e `GET /api/v1/health`.

### Provare il tabellone della sala d'attesa

Il monitor grande della sala è su <http://localhost:3000/display/sala-attesa>, impostato come i
tabelloni degli uffici pubblici: in alto i codici chiamati con l'accettazione a cui presentarsi (la
chiamata più recente in verde), in basso i prossimi turni. Con `?prossimi=6` si cambia quanti
turni elencare. Mostra solo codici, senza targhe né nomi, perché lo schermo è visibile a tutte le
persone presenti.

### Provare i monitor delle accettazioni

Ogni postazione di accettazione ha il suo schermo: <http://localhost:3000/display/1> (fino a `/display/4`; vale anche
il codice, `/display/C1`). La pagina è pensata per un televisore in kiosk a tutto schermo e si
aggiorna ogni 2 secondi. Prendendo in carico una pratica dalla dashboard, il monitor dell'accettazione
assegnata mostra codice e targa su sfondo scuro; premendo **Completato** diventa verde con
"ACCETTAZIONE LIBERA / AVANZARE". Se il server smette di rispondere lo schermo lo dichiara, invece di
lasciare a video un codice non più valido.

Ogni accettazione ha un token nel seed (`display-demo-token-c1`…). Passandolo come `?token=` viene
verificato e un token errato riceve 403; senza token l'accesso resta consentito, perché i monitor
sono su rete interna. L'obbligatorietà è prevista con l'hardening.

### Provare l'accettazione al veicolo dal tablet

La vista per il tablet è su <http://localhost:3000/tablet>: mostra solo le pratiche dello
sportello dell'operatore collegato, con due schede, **In attesa** e **Le mie prese in carico**, e
pulsanti grandi da usare in piedi accanto alla vettura.

1. **Inizia check-in** prende in carico la pratica e apre a tutto schermo la scheda di ispezione.
2. **Giro del veicolo**: sei slot, uno per parte. **Frontale, Posteriore, Fiancata sinistra e
   Fiancata destra sono obbligatorie**; *Interni* e *Dettaglio danni* sono facoltative e accettano
   più scatti. Toccando uno slot si apre la fotocamera posteriore del tablet (su un computer si
   sceglie un file); l'anteprima compare subito con la rotella di attesa e resta nello slot a
   caricamento concluso. Il file finisce dietro `IMediaStorage`, cioè in
   `.data/uploads/<giornata>/<codice>/<parte>-<id>.<estensione>`, e si rilegge da
   `GET /api/v1/media/<chiave>` con la sessione attiva. Le foto restano lì anche dopo un riavvio.
3. In **Note veicolo / danni rilevati** si annota quanto visto durante il giro dell'auto.
4. **Completa check-in** resta disabilitato finché mancano le quattro foto obbligatorie (sotto al
   pulsante c'è l'elenco di cosa manca); lo stesso controllo è ripetuto dal server, quindi non si
   aggira da un'altra scheda. Una volta completo chiude la pratica, libera l'accettazione e invia al CRM note e indirizzi delle
   foto. Nel terminale del server compaiono le righe `[Media] file salvato: ...` e
   `[MOCK][Crm] notifyCheckIn {...}`; allo stesso modo, segnando un cliente assente dalla
   dashboard, compare `[MOCK][Crm] notifyNoShow {...}`.
5. Nella dashboard di accettazione, il clic sulla pratica apre il pannello con la sezione
   **Ispezione al veicolo**: le note e le foto, raggruppate per parte del veicolo e ingrandibili
   con un clic.

Il CRM non può bloccare l'officina: se non risponde (`MOCK_CRM_MODE=error`) l'accettazione si
chiude lo stesso e l'evento resta nella coda di uscita, pronto per il rinvio. Con
`MEDIA_STORAGE_DIR` si sposta la cartella dei file; con `MEDIA_STORAGE_PROVIDER=memory` si torna
allo storage in memoria delle prime demo (e `MOCK_MEDIA_LATENCY_MS` ne regola l'attesa simulata).

### La stessa app al banco e sul piazzale

L'applicazione è una sola: cambia il comportamento, non l'interfaccia. La soglia è **1024 px**.

- **Su tablet o telefono** (≤ 1024 px) "Prendi in carico" porta subito alla schermata di ispezione
  fotografica della pratica: è quello che l'accettatore farà comunque arrivato alla vettura.
- **Su monitor** (> 1024 px) "Prendi in carico" apre il pannello di dettaglio del cliente e si
  resta sulla coda.

In entrambi i casi c'è una via d'uscita: dal pannello di dettaglio di una pratica in carico si
apre l'ispezione a mano con **Passa al check-in / Ispeziona** (utile quando le foto arrivano per
email), e dall'ispezione si esce con **Salta foto per ora**, che riporta alla coda lasciando la
pratica in carico e le foto già scattate nel fascicolo: se piove o la vettura va spostata subito,
il check-in si riprende dopo dalla scheda "Le mie prese in carico".

La coda è tarata anche per il dito: righe alte, pulsanti di almeno 44 × 44 px e riga interamente
toccabile per aprire il dettaglio.

### Provare il cruscotto BDC

Serve un account con ruolo responsabile: `responsabile` / `demo`. Dalla dashboard di accettazione
segna assente un cliente del blocco **In ritardo / assenti**, poi apri
<http://localhost:3000/manager>: la riga compare subito nel cruscotto con nome, numero richiamabile
con un tocco, targa, veicolo, motivo e ora dell'assenza. **Segna come ricontattato** chiude il lead
(con **Con esito** si aggiunge una nota, per esempio "richiama lunedì"), e la spunta *Mostra anche i
già ricontattati* fa rivedere chi l'ha chiuso e quando.

La chiusura del lead è indipendente dal CRM: con `MOCK_CRM_MODE=error` la riga dice "CRM non
raggiungibile", ma il BDC può comunque telefonare e chiudere: l'evento resta in coda per il rinvio.

### Provare il portale cliente

Il portale si apre su <http://localhost:3000/qr> (alias breve di `/cliente`, adatto ai cartelli con
il QR code). Serve una targa presente nell'agenda del giorno: le targhe finte sono generate in modo
deterministico dal seme dei mock **e dalla data**, quindi cambiano ogni giorno. Per leggere quelle
di oggi apri la dashboard e copia una targa dalla colonna Targa, oppure interroga l'API:

```bash
curl -s -c /tmp/c.txt -H 'content-type: application/json' -d '{"username":"mario.rossi","password":"demo","workstationId":"ws-p2"}' http://localhost:3000/api/v1/auth/login >/dev/null && curl -s -b /tmp/c.txt 'http://localhost:3000/api/v1/queue?view=global'
```

Con la dashboard aperta su una postazione e il portale su un'altra scheda, ogni azione
dell'operatore si riflette sulla schermata del cliente entro cinque secondi.

## Fine giornata e coda verso il CRM

**Chiusura giornata.** A officina chiusa il responsabile preme *Esegui chiusura giornata* nel
cruscotto BDC e conferma. Chi era ancora in coda viene segnato **assente** e compare subito fra i
lead da ricontattare (con l'evento verso il CRM); le accettazioni rimaste **in carico** vengono
annullate, perché non sono state concluse e non possono restare aperte fino al giorno dopo. Le
pratiche già completate non si toccano. Monitor e tabellone tornano vuoti da soli: le loro viste
derivano dalle pratiche aperte, non da uno stato salvato a parte.

**Coda di uscita verso il CRM.** Ogni evento (assenza, accettazione conclusa) viene prima scritto
in coda e poi inviato: se il CRM non risponde l'informazione non si perde. I rinvii sono automatici
con attesa progressiva — 1, 5, 15, 60 e 240 minuti, sei tentativi in tutto — e poi si fermano: un
CRM irrimediabilmente giù non deve far girare a vuoto il server. Da quel momento la riga resta nel
pannello **Sistema** (visibile agli amministratori) con stato, tentativi e ultimo errore, e il
pulsante **Forza riprova** la rispedisce quando il CRM è tornato su.

In produzione i rinvii possono essere affidati a un cron esterno: si spegne il temporizzatore
interno con `CRM_RETRY_ENABLED=false` e si chiama ogni N minuti

```bash
curl -s -X POST -H "x-cron-secret: $CRON_SECRET" http://localhost:3000/api/v1/system/cron/crm-retry
```

Le due strade possono convivere: ogni evento porta la propria chiave di idempotenza e il CRM la
riconosce, quindi un doppio invio non genera un doppio lead.

## Script disponibili

| Comando                 | Descrizione                                                     |
| ----------------------- | --------------------------------------------------------------- |
| `npm run dev`           | Server di sviluppo su <http://localhost:3000>                   |
| `npm run build`         | Build di produzione (output `standalone`)                       |
| `npm start`             | Avvio della build                                               |
| `npm run typecheck`     | TypeScript strict senza emissione                               |
| `npm run lint`          | ESLint (con guardia architetturale) e controllo encoding UTF-8/LF |
| `npm run format`        | Prettier su sorgenti, test e configurazioni                     |
| `npm test`              | Test unitari con Vitest                                         |
| `npm run test:coverage` | Test con copertura                                              |

## Struttura del repository

```
src/
├── app/            Pagine e Route Handler Next.js (login, accettazione, sistema, api/v1)
├── application/    Casi d'uso: auth, queue (QueueService, CodeGenerator), sync, health, notifications
├── components/     UI riusabile (primitive in ui/, shell in layout/)
├── config/         Composition root: env, seed, auth, container
├── domain/         Entità, value object, state machine, eventi (codice puro)
├── hooks/          Hook React (polling della coda, azioni)
├── lib/            Utilità: date, hash password, client API, helper HTTP
├── modules/        Componenti di modulo (reception = dashboard accettazione)
├── repositories/   Interfacce di persistenza e implementazione in memoria
└── services/       Porte esterne, DTO, mapper e Mock (Infinity, Spoki, SMS Hosting, CRM)
tests/              Test unitari Vitest
```

## Documentazione

- [`ARCHITECTURE.md`](ARCHITECTURE.md): stack, Regola d'Oro Mock-First, modello di dominio, decisioni.
- [`TASKS.md`](TASKS.md): piano di lavoro per milestone (M0 bootstrap → M7 passaggio ai servizi reali).
- [`docs/ANALISI_REQUISITI.md`](docs/ANALISI_REQUISITI.md): requisiti e flussi operativi.
- [`CLAUDE.md`](CLAUDE.md): regole di sviluppo e priorità.
