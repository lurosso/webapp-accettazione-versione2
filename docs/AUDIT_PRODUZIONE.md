# Resoconto diagnostico per la produzione

> Audit finale del 2026-09-14, al termine della milestone M8. Ruolo: Principal Software Engineer.
> Il documento risponde a tre domande: cosa manca per andare in produzione domani mattina, quali
> casi limite del flusso di accettazione non sono ancora coperti, qual è il passo successivo
> raccomandato. Ogni affermazione rimanda al punto del codice che la sostiene.

## 1. Fotografia dello stato

| Area | Stato | Evidenza |
| --- | --- | --- |
| Funzionalità di business (coda, tablet, portale, monitor, BDC, admin, archivio) | complete e verificate in browser | `TASKS.md` M1–M8 |
| Test automatici | 222 test unitari e di contratto, verdi | `npx vitest run`; `tests/unit`, `tests/contracts` |
| Qualità del codice | TypeScript strict, ESLint con guardia architetturale, Prettier, controllo encoding | `npm run typecheck`, `npm run lint` |
| Sicurezza applicativa | sessione JWT HttpOnly, riverifica ruolo lato server, rate limit login e cambio password, tetto SSE, segreti a tempo costante, password provvisoria con cambio obbligatorio | `src/proxy.ts`, `src/app/_server/session.ts`, `src/lib/http/*` |
| Persistenza | **solo memoria**: tutto lo stato della giornata vive nel processo | `src/repositories/in-memory/InMemoryStore.ts` (esiste `toSnapshot()`, nessuno lo scrive su disco) |
| Integrazioni esterne | **tutte mock** (Infinity, Spoki, SMS Hosting, CRM). Aggiornamento 2026-09-15: esistono gli adapter reali di Spoki (sandbox) e di Infinity in lettura via ODBC, provato su `infinity02` (`docs/INFINITY_ODBC.md`) | `src/services/factory.ts`, `SERVICES_PROVIDER=mock` |
| Infrastruttura di rilascio | **assente**: nessun Dockerfile, nessuna pipeline, nessun runbook operativo | radice del repository, `.github/` inesistente |
| Osservabilità | log su console con contesto JSON e correlation id; nessuna metrica, nessun allarme | `src/services/mocks/ConsoleLogger.ts` |

In sintesi: l'applicazione è **funzionalmente completa e ben protetta**, ma è ancora un prototipo
dal punto di vista operativo. Le mancanze non sono nel codice di dominio, che è solido, ma in ciò
che gli sta intorno.

## 2. Cosa manca per andare in produzione "domani mattina"

Ordinati per gravità. I primi tre sono bloccanti: senza di essi il sistema non può essere usato in
officina nemmeno un giorno.

### 2.1 Persistenza reale (bloccante)

Tutti i repository sono in memoria. Un riavvio del processo, un deploy, un crash o un aggiornamento
di Windows sul server cancellano **la giornata in corso**: pratiche prese in carico, completamenti,
lead del BDC, coda di uscita verso il CRM, metadati delle foto. I file delle foto restano su disco
(`.data/uploads`) ma diventano orfani, perché i loro record non esistono più.

- La porta è pronta: `IAppointmentRepository`, `IOperatorRepository`, `IMediaRepository`,
  `ICrmOutboxRepository`, `INotificationRepository`, `ISyncRunRepository`, `IReferenceDataRepository`
  sono interfacce e `repositories/factory.ts` accetta già `REPOSITORY_PROVIDER=prisma`
  (oggi risponde `NotImplemented`).
- Serve: schema Prisma + PostgreSQL (o SQL Server, se l'IT preferisce restare in casa Microsoft),
  migrazioni versionate, implementazioni `Prisma*Repository` che superino gli stessi test dei
  repository in memoria (da estrarre come suite di contratto, come già fatto per lo storage media
  in `tests/contracts/media-storage.contract.ts`), concorrenza ottimistica su `version` a livello di
  `UPDATE ... WHERE version = ?`.
- Attenzione a: gli operatori e le password (oggi nel seed) devono migrare nel database, con uno
  script di primo popolamento; la retention delle foto deve girare in una transazione per record.
- Stima: 4–6 giorni di lavoro per repository, migrazioni, suite di contratto e script di seed.

### 2.2 Inserimento manuale della pratica (bloccante)

È il fallback numero uno previsto da `CLAUDE.md` ("l'officina non deve mai bloccarsi") e da
`ARCHITECTURE.md` §6.6, ma **non esiste**: non c'è né la pagina `/accettazione/nuova` né una rotta
`POST /api/v1/appointments`. Oggi, se Infinity non risponde alle 06:00 o se un cliente si presenta
senza appuntamento, l'accettatore non ha modo di creare la pratica: il cliente resta fuori dalla
coda, dai monitor e dal portale. Il resto del sistema è già pronto a riceverla (`source: 'MANUAL'`
è previsto dal dominio e la policy dei messaggi invia la conferma `BOOKING_CONFIRMED` proprio per
gli inserimenti manuali).

- Serve: caso d'uso `QueueService.createManual` (codice progressivo dal `CodeGenerator`, sportello
  della postazione, cliente e veicolo minimi, targa validata), rotta POST con Zod e
  `Idempotency-Key`, pagina con form essenziale (targa, nome, telefono, lavorazione) raggiungibile
  in due tocchi dalla coda e dal tablet, riconciliazione con la sync successiva (se Infinity porta
  lo stesso appuntamento, la pratica manuale non va duplicata: chiave = targa + giornata).
- Stima: 2 giorni.

### 2.3 Adapter reale di Infinity, almeno in lettura (bloccante)

Senza Infinity l'applicazione non ha dati. Il factory, il DTO (`services/dto/infinity.dto.ts`), il
mapper e il decoratore di resilienza (`InfinityServiceResilient`: timeout, ripetizioni,
interruttore di circuito) sono pronti; manca la specifica reale (vista SQL? export? API?) e
l'implementazione `InfinityServiceHttp` o `InfinityServiceSql`. È il primo punto della checklist
di `ARCHITECTURE.md` §10.2 (M7-T01) e non dipende da noi: va **richiesta subito** all'IT del
gestionale, perché è il collo di bottiglia del calendario.

- Serve: specifica, adapter, test di contratto registrati su dati reali anonimizzati, gestione
  delle differenze di codifica (targhe estere, clienti senza telefono, appuntamenti riprogrammati).
- Stima: 3 giorni dopo la ricezione della specifica.

**Aggiornamento 2026-09-15.** L'accesso è il database stesso, via ODBC (SQL Anywhere 12):
`InfinityServiceOdbc` legge il planning (`tdo_pre` e tabelle collegate) ed è stato provato sulla
copia `infinity02` con dati reali (`docs/INFINITY_ODBC.md`): nomi cliente, cellulari, lavorazioni
con ore stimate, modello e stato documento sono tutti leggibili con la sola `SELECT`. Restano da
chiedere all'IT del gestionale: il DSN `Infinity01` e `GRANT EXECUTE ON dba.sp_off_docs_planning`
(la procedura del planning nativo; senza, l'adapter legge le tabelle e riconosce le annullate dallo
stato documento). Il punto non è più bloccante per il pilota.

### 2.4 Confezionamento e rilascio (necessario)

- **Dockerfile** multi-stage (`output: 'standalone'` è già impostato in `next.config.ts`), utente non root, volume per
  `.data/uploads`, healthcheck su `/api/v1/health?probe=dependencies`.
- **docker-compose** (o manifest equivalente) con PostgreSQL e un reverse proxy con TLS
  (Caddy o Nginx): il cookie di sessione è `Secure` solo in produzione e la fotocamera del tablet
  richiede HTTPS.
- **Pipeline CI** (GitHub Actions): typecheck, lint, test, build su ogni push; immagine pubblicata
  su tag. Oggi i controlli girano solo sulla macchina dello sviluppatore.
- **Configurazione**: `.env.example` documenta 35 variabili, ma `parseEnv` accetta valori errati
  con un avviso invece di rifiutarli (M0-T10, validazione Zod dell'ambiente, è ancora aperta).
  In produzione un valore sbagliato deve fermare l'avvio, come già fa `SESSION_SECRET`.
- Stima: 2 giorni.

### 2.5 Osservabilità e operatività (necessario)

- **Log strutturati**: `ConsoleLogger` scrive righe con contesto JSON, ma non JSON puro; serve un
  logger (pino) con livello configurabile, output JSON per il collettore, redazione dei dati
  personali (telefoni, targhe) nei log.
- **Metriche e allarmi**: nessuno viene avvisato se la sync delle 06:00 fallisce, se la coda CRM
  accumula eventi `FAILED`, se l'interruttore di circuito verso Infinity resta aperto. Servono un
  endpoint `/api/v1/metrics` (Prometheus) o almeno un allarme e-mail/Teams sui tre eventi citati.
- **Backup**: strategia per il database e per `.data/uploads` (le foto valgono 30 giorni, il backup
  può essere quotidiano con la stessa retention).
- **Runbook**: cosa fare se Infinity non risponde, se il CRM è giù, se un tablet non carica, come
  ruotare `SESSION_SECRET` e `CRON_SECRET`, come creare il primo amministratore.
- Stima: 2 giorni.

### 2.6 Un processo solo (vincolo da conoscere, non da risolvere subito)

Rate limit, tetto alle connessioni SSE, scheduler della giornata, rinvii CRM e bus degli eventi
vivono nel processo (`Map` e `globalThis`). Con **una** istanza dell'applicazione funzionano; con
due istanze dietro un bilanciatore i limiti si dimezzano, gli scheduler girano due volte e un
evento SSE arriva solo ai client connessi alla stessa istanza. Per un'officina una istanza basta:
va scritto nel runbook e nel manifest (`replicas: 1`), e va lasciato ai cron esterni
(`/api/v1/system/cron/*`) il lavoro periodico quando si vorrà scalare.

### 2.7 Rifiniture di sicurezza (consigliate)

- Content-Security-Policy (rinviata in `next.config.ts`: richiede l'inventario degli script inline
  di Next).
- Registro delle azioni amministrative (chi ha creato, disattivato, azzerato chi): oggi solo nei
  log.
- Cookie di sessione `SameSite=Lax` e API JSON senza CORS proteggono dal CSRF classico; con un
  reverse proxy va verificato che `X-Forwarded-For` sia affidabile, perché il rate limit del login
  lo usa (`clientIpFrom`).
- La chiave HS256 è condivisa: se si andrà a più istanze o a un IdP aziendale (Entra ID, previsto
  come adapter di `IAuthService`), il passaggio è indolore perché pagine e rotte parlano solo con
  la porta.

## 3. Casi limite del flusso di accettazione non ancora coperti

Dal più grave. Per ciascuno: cosa succede oggi, perché conta, cosa serve.

1. **Cliente senza appuntamento o arrivato in un giorno diverso da quello prenotato.** Oggi non
   entra in coda (vedi 2.2). È il caso più frequente dopo il flusso normale.
2. **"Completato" premuto per errore.** `COMPLETED` è uno stato finale (`ALLOWED_TRANSITIONS`,
   `appointment-state-machine.ts`): non si torna indietro, la campata è liberata e il CRM ha già
   ricevuto il check-in. Serve una riapertura riservata al manager (`COMPLETED → IN_PROGRESS`
   entro N minuti, con motivazione ed evento di correzione verso il CRM).
3. **Chiusura automatica delle 19:00 con pratiche ancora in carico.** Vengono **annullate**
   (`QueueService.closeBusinessDay`). Ma una pratica "in carico" alle 19:00 è quasi sempre un
   veicolo accettato di cui l'operatore ha dimenticato di premere Completato: annullarla sporca i
   KPI e nessun check-in arriva al CRM. Meglio uno stato di attenzione ("chiusa d'ufficio, da
   confermare") che il manager risolve la mattina dopo, oppure una notifica all'operatore prima
   della chiusura.
4. **Due appuntamenti per la stessa targa nello stesso giorno** (auto che torna nel pomeriggio,
   o doppio inserimento su Infinity). `findByPlate` restituisce un elenco e il portale cliente
   mostra il primo: il cliente potrebbe leggere il turno sbagliato. Serve una regola esplicita (il
   primo non concluso) e un avviso in coda.
5. **Appuntamenti che Infinity aggiunge o sposta durante la giornata.** Arrivano solo con
   "Riprova sync" manuale (la sync automatica è alle 06:00). Con l'adapter reale servirà una
   ri-sincronizzazione periodica (ogni 10–15 minuti) non distruttiva, già supportata dalla
   semantica di `SyncService` ma non pianificata.
6. **Tablet senza rete durante il giro foto.** Un caricamento fallito mostra l'errore e si
   riscatta, ma non esiste una coda persistente con riprova automatica (M5-T03-S02b/c): se la
   rete cade a metà giro, l'operatore rifà le foto. Sul piazzale la copertura Wi-Fi è il punto
   debole tipico.
7. **Foto HEIC da iPad.** `image/heic` è accettato dal caricamento ma i browser desktop non lo
   mostrano: nella galleria e nell'archivio la foto risulterebbe rotta. Serve la conversione lato
   client (canvas → JPEG) o il rifiuto esplicito con messaggio.
8. **Cliente senza telefono o con consenso WhatsApp negato.** Gestito (`NO_RECIPIENT`, ripiego
   SMS, esito visibile nel dettaglio), ma la conferma dell'inserimento manuale e il "turno vicino"
   restano muti senza segnalarlo all'accettatore in coda: basterebbe un'icona.
9. **Più di quattro veicoli in carico contemporaneamente.** Il quinto resta "senza accettazione"
   (`bayId: null`): corretto, ma i monitor non lo chiamano mai e il cliente non sa dove andare.
   Serve un messaggio al tabellone ("presentarsi al banco").
10. **Sessione scaduta (8 ore) a metà check-in.** Le note sono salvate prima della chiusura e il
    401 riporta al login con ritorno alla pagina: il caso è coperto, ma le foto già caricate su una
    pratica che poi un collega rimette in coda restano nel fascicolo senza segnalazione. Accettabile.
11. **Account KIOSK.** Deve scegliere una postazione al login (non ha senso per un monitor) e gli
    schermi pubblici funzionano anche senza sessione: il ruolo oggi serve solo a tenere quei
    dispositivi fuori dall'area operatore. Va deciso se legare il token dei monitor
    (`DISPLAY_TOKEN_REQUIRED`) a questi account, altrimenti il ruolo resta decorativo.

## 4. Raccomandazione finale

**Il progetto non è chiuso per il deploy: è chiuso per il perimetro funzionale.** Le funzionalità
richieste dall'analisi sono tutte realizzate, verificate e protette, e l'architettura a porte
permette di sostituire i mock senza toccare le schermate. Ma tre mancanze impediscono di usarlo
in officina anche solo per un giorno: lo stato vive in memoria, non si può inserire una pratica a
mano, e i dati veri di Infinity non arrivano.

Il passo successivo che raccomando con forza è una milestone **M9 "Pilota"**, in quest'ordine:

1. **Inserimento manuale della pratica** (2 giorni): è piccolo, è il fallback che la regola d'oro
   promette, e serve anche in pilota quando la sync non funziona.
2. **Persistenza PostgreSQL con Prisma** (4–6 giorni): repository, migrazioni, suite di contratto
   condivisa con le implementazioni in memoria (che restano per i test), seed del primo
   amministratore.
3. **Dockerfile, compose con database e reverse proxy TLS, pipeline CI, log JSON** (2 giorni).
4. **Adapter Infinity in sola lettura** (3 giorni dalla specifica): da richiedere all'IT **oggi**,
   perché è l'attività con il tempo di attesa più lungo.

Dopo M9 si può fare un pilota reale su **uno** sportello con Spoki, SMS e CRM ancora mock (i
messaggi restano in console, il BDC lavora dal cruscotto): è il modo più sicuro di scoprire i casi
limite veri dell'officina prima di attivare le comunicazioni verso i clienti. Le integrazioni
Spoki/SMS/CRM (M7-T02) vengono dopo, una porta alla volta, ciascuna con il proprio test di
contratto e la propria bandierina di attivazione.

Due correzioni funzionali dell'elenco al §3 meritano di entrare in M9 anche se non bloccano:
la **riapertura di una pratica completata per errore** (punto 2) e la **gestione delle pratiche
ancora in carico alla chiusura automatica** (punto 3), perché toccano i numeri che il BDC e la
direzione leggeranno ogni giorno.
