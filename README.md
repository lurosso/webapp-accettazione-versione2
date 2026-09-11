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
| **Prendi in carico**  | In carico (evidenza gialla) | Assegna l'operatore e una campata libera             |
| **Salta**             | Saltata                     | Pospone la pratica lasciandola al proprio orario     |
| **Completato**        | Completata (evidenza verde) | Libera la campata; la pratica esce dalla vista attiva |

Il **portale cliente** completa il quadro: chi entra in officina inquadra il QR code della corsia,
digita la targa e vede il proprio codice, quanti clienti ha davanti e cosa deve fare, con la pagina
che si aggiorna da sola mentre l'operatore lavora. Sopra ogni campata un **monitor** mostra il
codice in lavorazione e, appena l'accettatore chiude la pratica, invita il cliente successivo ad
avanzare. Restano da sviluppare le **comunicazioni** WhatsApp con fallback SMS e l'acquisizione
**foto/video** da tablet. La priorità di sviluppo è definita in [`CLAUDE.md`](CLAUDE.md); i
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
- **Spoki** (WhatsApp) e **SMS Hosting** (SMS di fallback): `ISpokiService` / `ISmsHostingService` →
  i mock simulano successi e fallimenti in base all'ultima cifra del telefono, così il fallback
  WhatsApp → SMS → contatto manuale è verificabile senza inviare nulla.
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

Al login si scelgono **Sportello / Brand** e **Postazione** (P1–P4, ognuna con una campata
predefinita): determinano il filtro iniziale della coda e la campata proposta alla presa in carico.

## Le dashboard

| Percorso              | Destinatario   | Stato          | Contenuto                                                                                 |
| --------------------- | -------------- | -------------- | ----------------------------------------------------------------------------------------- |
| `/login`              | Accettatore    | disponibile    | Credenziali, scelta sportello/brand e postazione                                          |
| `/accettazione`       | Accettatore    | disponibile    | Coda ordinata per orario con codici F001…, azioni rapide, banner sync, **vista globale** per prendere in carico pratiche di altri sportelli, aggiornamento ogni 3 s |
| `/sistema`            | Responsabile   | disponibile    | Stato delle porte esterne (Infinity, Spoki, SMS Hosting, CRM)                              |
| `/cliente` (`/qr`)    | Cliente (QR)   | disponibile    | Ricerca per targa e stato del turno in tempo reale: codice, clienti in attesa, messaggio per stato; nessuna autenticazione e nessun dato personale |
| `/comunicazioni`      | Responsabile   | pianificato M3 | Registro invii WhatsApp/SMS e fallback manuale                                            |
| `/display/1` … `/4`   | Monitor        | disponibile    | Schermo a tutto campo per i monitor sopra le campate: codice e targa in servizio, oppure invito verde ad avanzare; si aggiorna ogni 2 secondi |
| `/ispezione`          | Tablet         | pianificato M5 | Foto e video associati alla pratica                                                       |

API principali (JSON, autenticate via cookie di sessione): `GET /api/v1/queue`,
`POST /api/v1/appointments/{id}/actions`, `POST /api/v1/sync`, `POST /api/v1/auth/login`.
Pubbliche, senza sessione: `GET /api/v1/public/status?targa=AB123CD` (stato del turno, protetta da
limiti di frequenza) e `GET /api/v1/health`.

### Provare i monitor delle campate

Ogni campata ha il suo schermo: <http://localhost:3000/display/1> (fino a `/display/4`; vale anche
il codice, `/display/C1`). La pagina è pensata per un televisore in kiosk a tutto schermo e si
aggiorna ogni 2 secondi. Prendendo in carico una pratica dalla dashboard, il monitor della campata
assegnata mostra codice e targa su sfondo scuro; premendo **Completato** diventa verde con
"CAMPATA LIBERA / AVANZARE". Se il server smette di rispondere lo schermo lo dichiara, invece di
lasciare a video un codice non più valido.

Ogni campata ha un token nel seed (`display-demo-token-c1`…). Passandolo come `?token=` viene
verificato e un token errato riceve 403; senza token l'accesso resta consentito, perché i monitor
sono su rete interna. L'obbligatorietà è prevista con l'hardening.

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
