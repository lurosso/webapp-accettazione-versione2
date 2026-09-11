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
| `/sistema`            | Responsabile   | disponibile    | Stato delle porte esterne (Infinity, Spoki, SMS Hosting, CRM)                              |
| `/cliente` (`/qr`)    | Cliente (QR)   | disponibile    | Ricerca per targa e stato del turno in tempo reale: codice, clienti in attesa, messaggio per stato; nessuna autenticazione e nessun dato personale |
| `/display/sala-attesa` | Sala d'attesa | disponibile    | Tabellone stile ufficio pubblico: codici chiamati con l'accettazione a cui presentarsi e prossimi turni |
| `/manager`            | BDC / Responsabile | disponibile | Cruscotto del back office: clienti segnati assenti da ricontattare, con telefono richiamabile e chiusura del lead con esito; si aggiorna ogni 10 secondi |
| `/comunicazioni`      | Responsabile   | pianificato    | Registro degli invii WhatsApp e SMS con conferma manuale (l'invio automatico funziona già) |
| `/display/1` … `/4`   | Monitor        | disponibile    | Schermo a tutto campo per i monitor sopra le postazioni: codice e targa in servizio, oppure invito verde ad avanzare; si aggiorna ogni 2 secondi |
| `/tablet`             | Tablet         | disponibile    | Accettazione al veicolo: le pratiche del proprio sportello in due schede grandi, check-in a tutto schermo con fotocamera e note sui danni rilevati |

API principali (JSON, autenticate via cookie di sessione): `GET /api/v1/queue`,
`POST /api/v1/appointments/{id}/actions`, `POST /api/v1/appointments/{id}/media` (foto, multipart),
`POST /api/v1/appointments/{id}/check-in`, `POST /api/v1/sync`, `POST /api/v1/auth/login`,
`GET /api/v1/crm/leads` e `POST /api/v1/crm/leads/{id}/contacted` (responsabile e amministratore).
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
2. **Scatta foto** apre la fotocamera posteriore del tablet (su un computer si sceglie un file).
   L'anteprima compare subito con la rotella di attesa e resta nella griglia a caricamento
   concluso; il file finisce dietro `IMediaStorage`, cioè in
   `.data/uploads/<giornata>/<codice>/<id>.<estensione>`, e si rilegge da
   `GET /api/v1/media/<chiave>` con la sessione attiva. Le foto restano lì anche dopo un riavvio.
3. In **Note veicolo / danni rilevati** si annota quanto visto durante il giro dell'auto.
4. **Completa check-in** chiude la pratica, libera l'accettazione e invia al CRM note e indirizzi delle
   foto. Nel terminale del server compaiono le righe `[Media] file salvato: ...` e
   `[MOCK][Crm] notifyCheckIn {...}`; allo stesso modo, segnando un cliente assente dalla
   dashboard, compare `[MOCK][Crm] notifyNoShow {...}`.
5. Nella dashboard di accettazione, il clic sulla pratica apre il pannello con la sezione
   **Ispezione al veicolo**: le note e le foto scattate, ingrandibili con un clic.

Il CRM non può bloccare l'officina: se non risponde (`MOCK_CRM_MODE=error`) l'accettazione si
chiude lo stesso e l'evento resta nella coda di uscita, pronto per il rinvio. Con
`MEDIA_STORAGE_DIR` si sposta la cartella dei file; con `MEDIA_STORAGE_PROVIDER=memory` si torna
allo storage in memoria delle prime demo (e `MOCK_MEDIA_LATENCY_MS` ne regola l'attesa simulata).

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
