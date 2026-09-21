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
- [Mappa delle rotte](#mappa-delle-rotte)
- [Il planning di Infinity dal database reale (ODBC)](#il-planning-di-infinity-dal-database-reale-odbc)
- [Amministrazione, archivio foto e retention](#amministrazione-archivio-foto-e-retention)
- [Script disponibili](#script-disponibili)
- [Struttura del repository](#struttura-del-repository)
- [Documentazione](#documentazione)

## Cosa fa

Ogni mattina alle 06:00 il sistema acquisisce l'agenda degli appuntamenti dal DMS **Infinity**,
assegna a ogni pratica un codice progressivo univoco (`F001`, `F002`, …) in ordine di prenotazione e
la mette in coda. Gli accettatori lavorano su una dashboard monopagina con tre azioni rapide:

| Azione               | Stato risultante            | Effetto                                                     |
| -------------------- | --------------------------- | ----------------------------------------------------------- |
| **Prendi in carico** | In carico (evidenza gialla) | Assegna l'operatore e una postazione di accettazione libera |
| **Salta**            | Saltata                     | Pospone la pratica lasciandola al proprio orario            |
| **Completato**       | Completata (evidenza verde) | Libera lo sportello; la pratica esce dalla vista attiva     |

Una pratica presa in carico ha un solo comando, **Completato**. Il vecchio pulsante _Rilascia_, che
la rimetteva in coda svuotando operatore e sportello, è stato tolto dalla riga (2026-09-17): stava
a un centimetro dal verde ed era un tocco involontario che faceva sparire una prenotazione. Rimane
possibile rimetterla in coda, ma dal **pannello di assistenza** in Amministrazione, e l'API la
consente solo a responsabili e amministratori.

Chi era atteso da più di dieci minuti e non è ancora stato preso in carico finisce nel blocco
**In ritardo / assenti**, dove l'accettatore lo rimette in coda quando arriva, oppure lo segnala
assente perché il BDC lo ricontatti.

Il **portale cliente** completa il quadro: la mattina il cliente riceve su WhatsApp il promemoria
con tre risposte — «Arrivato», «In ritardo», «Assente» — e toccando **Arrivato** gli tornano il
codice e il link alla sua pagina di tracciamento (il QR in corsia resta come strada alternativa).
Lì vede la posizione in fila, la lettera dello sportello quando tocca a lui e gli orari di arrivo e
chiamata, con la pagina che si aggiorna da sola mentre l'operatore lavora. Sopra ogni postazione un **monitor** mostra il
codice in lavorazione e, appena l'accettatore chiude la pratica, invita il cliente successivo ad
avanzare. Le **comunicazioni** partono da sole dopo la sincronizzazione dell'agenda, con WhatsApp
via Spoki e ripiego automatico su SMS. Dal **tablet** l'accettatore fa il giro della vettura, gira
il video (l'unico passaggio obbligatorio), aggiunge le foto che servono, annota i danni e chiude il
check-in dopo una conferma. Note, foto e video finiscono nel fascicolo della pratica, si rivedono
dalla dashboard e arrivano al CRM. Chi non si presenta finisce nel **cruscotto
BDC**, che è solo l'elenco degli assenti da richiamare e riprogrammare; le statistiche della
giornata stanno in Amministrazione. Restano da sviluppare il registro degli
invii, i video e la vista tecnica degli eventi CRM. La priorità di sviluppo è definita in [`CLAUDE.md`](CLAUDE.md); i
requisiti completi sono in [`docs/ANALISI_REQUISITI.md`](docs/ANALISI_REQUISITI.md).

## Identità visiva

I colori dell'interfaccia sono quelli del marchio: blu istituzionale `#0065A0`, verde `#87BD22`,
grigi `#2E2E2E` e `#F2F2F2`, presi dalle variabili CSS pubblicate da
[autoclubgroup.it](https://www.autoclubgroup.it/). Stanno in `src/app/globals.css` come token
`--color-brand-*`, insieme alla scala neutra ritinta sul blu: cambiando quei valori cambia tutta
l'applicazione. I colori di stato della coda (in attesa, in carico, completata, assente) restano
invece indipendenti dal marchio, perché comunicano un'informazione e non uno stile.

I due colori del marchio hanno un significato preciso, non solo estetico: il **verde**
(`bg-brand-primary`) compare esclusivamente sulle azioni che completano o fanno avanzare un lavoro
(Completa check-in, Completato, Segna come ricontattato); il **blu** (`bg-brand-secondary`) veste
struttura, navigazione e azioni secondarie (Prendi in carico, Passa al check-in, schede e filtri).
Sul piazzale l'occhio trova così in un attimo il pulsante che chiude il giro.

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
  manuale è verificabile senza inviare nulla a nessuno. Per Spoki esiste anche l'adapter reale in
  **modalità sandbox** (`SPOKI_PROVIDER=real`, `SPOKI_MODE=simulation`): stesso codice della
  produzione, nessuna chiamata di rete, payload leggibili in `/admin` (vedi più sotto). Le cifre: da 0 a 6 WhatsApp consegnato,
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

Per lavorare sui dati veri si passa al profilo `real` (`SEED_PROFILE=real` in `.env.local`, con
`SEED_ADMIN_PASSWORD_HASH`, `SEED_DISPLAY_TOKEN_SECRET` e `SESSION_SECRET` generati da
`npm run seed:credenziali`): le due aree per marchio con i marchi del planning di Bari più «Altri marchi», un
solo account `admin` con password provvisoria da cambiare al primo accesso, accettatori creati da
`/admin`.

**Accesso veloce (solo sviluppo).** Fuori dalla produzione la pagina di login mostra un riquadro
ambra con un pulsante per profilo: Amministratore, Responsabile / BDC e un Accettatore per ogni
sportello. Un tocco crea al primo uso l'account `dev.*` corrispondente (password casuale, mai
comunicata) ed entra senza credenziali: serve a cambiare ruolo in fretta durante il debug e dopo ogni
riavvio, quando lo store in memoria si azzera. Si governa con `DEV_QUICK_LOGIN` (acceso di default
in sviluppo, ignorato con `NODE_ENV=production`); la rotta `POST /api/v1/auth/quick-login` risponde
404 quando è spento.

| Utente          | Ruolo          | Sportello abituale                           |
| --------------- | -------------- | -------------------------------------------- |
| `admin`         | Amministratore | tutti                                        |
| `responsabile`  | Responsabile   | tutti                                        |
| `mario.rossi`   | Accettatore    | Sportello B · FCA (Fiat, Lancia, Jeep, Alfa) |
| `laura.bianchi` | Accettatore    | Sportello C · PSA (Peugeot, Citroën, Opel)   |
| `andrea.conti`  | Accettatore    | Sportello D · PSA                            |

Gli account si gestiscono da `/admin` (vedi sotto): l'amministratore ne crea di nuovi, li modifica,
li disattiva e azzera le password senza toccare il seed. Esiste anche il ruolo **Kiosk** per gli
account dei dispositivi, che atterrano sul tabellone e non entrano nell'area operatore.

**Chi vede cosa.** Dal 2026-09-17 i ruoli stanno in recinti espliciti, elencati in un solo posto
(`AREA_ROLES` in `src/lib/navigation.ts`), che valgono per le pagine, per il menu e per le API:

| Ruolo                  | Dove entra                                       |
| ---------------------- | ------------------------------------------------ |
| **Accettatore**        | Coda, archivio, check-in, Sistema                |
| **Responsabile / BDC** | Solo il cruscotto BDC (`/manager`, alias `/bdc`) |
| **Amministratore**     | Tutto                                            |
| **Kiosk**              | Solo il tabellone della sala                     |

Il BDC vive in un silos: se apre `/accettazione`, `/check-in` o `/sistema` viene riportato al proprio
cruscotto, e le stesse rotte chiamate via API rispondono 403. Non è sfiducia, è responsabilità: la
coda la governano gli accettatori al banco, e una pratica presa in carico da chi sta al telefono è
una pratica che nessuno sta accettando.

Al login si sceglie una sola cosa, lo **Sportello** (A, B, C o D): ogni voce porta con sé la propria
area per marchio e i marchi serviti ("Sportello A · FCA", con i badge Fiat, Lancia, Jeep e Alfa
Romeo sotto), e determina il filtro iniziale della coda e lo sportello proposto alla presa in
carico. Gli sportelli occupati restano in elenco ma **non si possono scegliere**: se un collega è
già collegato allo Sportello A, o ha un veicolo in carico lì, la voce è disabilitata con il motivo
accanto ("in uso da Mario Rossi") finché non esce o la sua sessione scade. Il controllo lo fa
anche il server, quindi due login sullo stesso posto non passano nemmeno chiamando l'API.

## Le dashboard

| Percorso                 | Destinatario       | Stato       | Contenuto                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------ | ------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/login`                 | Accettatore        | disponibile | Credenziali, scelta sportello/brand e postazione                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `/accettazione`          | Accettatore        | disponibile | Coda ordinata per orario con codici F001…, azioni rapide, blocco **In ritardo / assenti**, banner sync, **vista globale** per prendere in carico pratiche di altri sportelli, aggiornamento ogni 3 s; il clic su una riga apre i dati del cliente; **Nuovo cliente (senza appuntamento)** mette in coda un walk-in con targa, nome, telefono, marca e lavorazione; dal dettaglio di una pratica completata si può **riaprirla**; le righe con l'orario superato da meno di dieci minuti sono **gialle** e un cliente segnato assente che si presenta si **riattiva** ("Arrivato in ritardo": torna in coda dopo i presenti, con lo stesso codice) |
| `/sistema`               | Responsabile / IT  | disponibile | Stato delle porte esterne (Infinity, Spoki, SMS Hosting, CRM) e, per gli amministratori, la coda di uscita verso il CRM con "Forza riprova"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `/cliente` (`/qr`)       | Cliente (QR)       | disponibile | Ricerca per targa e stato del turno in tempo reale: codice, clienti in attesa, messaggio per stato; nessuna autenticazione e nessun dato personale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `/display/sala-attesa`   | Sala d'attesa      | disponibile | Tabellone stile ufficio pubblico: codici chiamati con la lettera dello sportello a cui presentarsi e prossimi turni                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `/manager`               | BDC / Responsabile | disponibile | Cruscotto del back office: clienti segnati assenti da ricontattare, con telefono richiamabile e chiusura del lead con esito; da qui si esegue anche la chiusura di giornata                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `/comunicazioni`         | Responsabile       | pianificato | Registro degli invii WhatsApp e SMS con conferma manuale (l'invio automatico funziona già)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `/display/A` … `/D`      | Monitor            | disponibile | Schermo a tutto campo per i monitor sopra i quattro sportelli: lettera, codice e targa in servizio, oppure invito verde ad avanzare; si aggiorna ogni 2 secondi                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `/check-in`              | Tablet             | disponibile | Check-in veicolo a tutto schermo, senza l'intestazione del sito: le pratiche del proprio sportello in due schede grandi, foto a slot con «+ Foto» e «Video» (mai obbligatori), note con annotazioni rapide, comandi fissi in basso (il vecchio `/tablet` rimanda qui)                                                                                                                                                                                                                                                                                                                                                                             |
| `/accettazione/archivio` | Accettatore        | disponibile | Archivio delle ispezioni: ricerca per targa o codice, schede con le foto per categoria; i file oltre la retention risultano eliminati ma la scheda resta                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `/admin`                 | Amministratore     | disponibile | Gestione operatori (crea, modifica, disattiva, reset password), strumenti di assistenza (accettazioni occupate, pratiche in carico da troppo tempo, rimetti in coda o annulla) e integrazione Spoki (stato, messaggio di prova, registro dei payload)                                                                                                                                                                                                                                                                                                                                                                                             |

API principali (JSON, autenticate via cookie di sessione): `GET /api/v1/queue`,
`POST /api/v1/appointments/{id}/actions`, `POST /api/v1/appointments/{id}/media` (foto, multipart),
`POST /api/v1/appointments/{id}/check-in`, `POST /api/v1/sync`, `POST /api/v1/auth/login`,
`GET /api/v1/crm/leads` e `POST /api/v1/crm/leads/{id}/contacted` (responsabile e amministratore),
`POST /api/v1/system/close-day` (chiusura giornata), `GET /api/v1/crm/outbox` e
`POST /api/v1/crm/outbox/{id}/retry` (amministratore), `GET /api/v1/inspections/archive?q=` (archivio),
`GET|POST /api/v1/admin/operators`, `PATCH /api/v1/admin/operators/{id}`,
`POST /api/v1/admin/operators/{id}/reset-password` e `GET /api/v1/admin/assistance` (amministratore),
`POST /api/v1/auth/change-password` (l'operatore cambia la propria password).
Pubbliche, senza sessione: `GET /api/v1/public/status?targa=AB123CD` (stato del turno, protetta da
limiti di frequenza) e `GET /api/v1/health`.

### I quattro sportelli: A, B, C, D

In sala ci sono quattro banchi, con la lettera appesa sopra. Lavorano a coppie per famiglia di
marchi: **A e B servono i marchi FCA** (Fiat, Lancia, Alfa Romeo, Jeep, EMC, Leapmotor) e **C e D i
marchi PSA** (Peugeot, Citroën, DS, Opel, XEV); «Altri marchi» lo prende chi è libero. La lettera è
l'unica indicazione che il cliente riceve, ed è la stessa ovunque: sul tabellone della sala ("F012
→ Sportello B"), sul monitor sopra il banco, sul portale dal telefono ("Vai allo sportello B") e
nel menu del login dell'accettatore ("Sportello B · FCA").

Nel dominio le due famiglie sono gli sportelli logici `FCA` e `PSA` (entità Desk, cioè il filtro
per marchio della coda), mentre ogni banco è una postazione con il proprio monitor (entità
Workstation e Bay, codici `A`…`D`). I vecchi indirizzi per numero restano validi.

### Provare il tabellone della sala d'attesa

Il monitor grande della sala è su <http://localhost:3000/display/sala-attesa>, impostato come i
tabelloni degli uffici pubblici: in alto i codici chiamati con la lettera dello sportello a cui
presentarsi (la chiamata più recente in verde), in basso i prossimi turni. Con `?prossimi=6` si cambia quanti
turni elencare. Mostra solo codici, senza targhe né nomi, perché lo schermo è visibile a tutte le
persone presenti.

### Provare i monitor degli sportelli

Ogni sportello ha il suo schermo: <http://localhost:3000/display/A> (fino a `/display/D`; valgono
ancora `/display/1`…`/display/4` e le vecchie targhette `/display/C1`, così i kiosk già
configurati non vanno rifatti). La pagina è pensata per un televisore in kiosk a tutto schermo e si
aggiorna ogni 2 secondi. In alto a sinistra c'è sempre la lettera, grande. Prendendo in carico una
pratica dalla dashboard, il monitor dello sportello assegnato mostra codice e targa su sfondo
scuro; premendo **Completato** diventa verde con "SPORTELLO A LIBERO / AVANZARE". Se il server
smette di rispondere lo schermo lo dichiara, invece di lasciare a video un codice non più valido.

Il token di uno sportello non esce dalla coda: `GET /api/v1/queue` restituisce degli sportelli solo
identificativo, lettera, numero, nome e stato, perché quel segreto serve ai kiosk e non alla
dashboard. Ogni sportello ha un token nel seed (`display-demo-token-a`…`-d`). Passandolo come `?token=` viene
verificato e un token errato riceve 403; senza token l'accesso resta consentito, perché i monitor
sono su rete interna. L'obbligatorietà è prevista con l'hardening. Nel profilo `real` i token
derivano dalla lettera: dopo questo cambio vanno riletti con `npm run seed:credenziali` e
riscritti negli URL dei kiosk.

### Riconsegne dei veicoli

Le commesse «in consegna» del planning di Infinity (righe `L`, `tipo R`: il veicolo torna al
cliente a fine lavori) entrano come flusso **RETURN**, con codici `R001…` e una numerazione
propria, e non passano dalla coda, dai monitor, dai promemoria né dal portale. Si vedono nella
scheda **Riconsegne (N)** della dashboard: ora prevista, targa, veicolo e cliente, commessa e stato
in officina (Accettata, In lavorazione, Collaudato…), stato della riconsegna. Quando Infinity segna
la commessa consegnata la riga diventa «Riconsegnata». `INFINITY_INCLUDE_WORK_ORDERS=false` le
esclude del tutto.

### Inserimento manuale e BDC

Il pulsante «Nuovo cliente (senza appuntamento)» resta nel codice e nell'API, ma l'inserimento
avviene a monte in Infinity dal BDC: per default lo vedono solo responsabili e amministratori
(`UI_MANUAL_INTAKE=managers`; `all` per tutti, `none` per nessuno).

### Archivio: la storia di una targa

In `/accettazione/archivio` la ricerca per targa (o per codice) elenca **ogni ingresso** del
veicolo su tutte le giornate, dal più recente, con data e ora, stato, commessa, lavorazioni e le
foto se ci sono; anche le riconsegne, segnate con il badge. Senza ricerca restano gli ultimi
check-in fotografici.

### Provare il check-in veicolo dal tablet

La vista per il tablet è su <http://localhost:3000/check-in> (a tutto schermo, senza il menu del
sito: una barra minima con "Coda" ed "Esci"; aggiunta alla schermata iniziale del tablet si apre
senza la barra degli indirizzi grazie al manifest PWA): mostra solo le pratiche dello
sportello dell'operatore collegato, con due schede, **In attesa** e **Le mie prese in carico**, e
pulsanti grandi da usare in piedi accanto alla vettura.

1. **Inizia check-in** prende in carico la pratica e apre a tutto schermo la scheda di ispezione.
2. **Video del veicolo (obbligatorio)**: il pulsante **▶ Video · obbligatorio** è ambra finché la
   ripresa manca e apre la fotocamera del tablet (mp4, mov, webm; fino a 80 MB, contro gli 8 MB di
   una foto). È l'unico passaggio richiesto: al ritiro è la ripresa che risponde alla contestazione
   di un graffio. Se la fotocamera non funziona la pratica si chiude comunque dalla coda in
   dashboard con **Completato**: l'officina non si ferma per un tablet.
3. **Foto, tutte facoltative**: quattro slot consigliati (Frontale, Posteriore, Fiancata sinistra,
   Fiancata destra) più _Interni_ e _Dettaglio danni_, ognuno con più scatti, e **+ Foto** per uno
   scatto libero fuori dalle caselle (finisce fra le "Foto aggiuntive"). Toccando uno slot si apre
   la fotocamera posteriore del tablet (su un computer si sceglie un file); l'anteprima compare
   subito con la rotella di attesa e resta nello slot a caricamento concluso. I file finiscono
   dietro `IMediaStorage`, cioè in
   `.data/uploads/<giornata>/<codice>/<parte>-<id>.<estensione>`, e si rileggono da
   `GET /api/v1/media/<chiave>` con la sessione attiva. Restano lì anche dopo un riavvio.
4. In **Note veicolo / danni rilevati** si annota quanto visto durante il giro dell'auto.
5. **Completa check-in** resta spento finché non c'è il video, con scritto sotto cosa manca; con il
   video diventa verde e apre una **conferma** ("Completare il check-in?" con il riepilogo del
   fascicolo e le note), perché su un tablet tenuto in mano un tocco involontario non deve chiudere
   un'accettazione. Lo stesso controllo è ripetuto dal server, quindi non si aggira da un'altra
   scheda. Una pratica completata per errore si riapre dal dettaglio ("Riapri pratica / Modifica
   check-in") e torna in carico a chi la riapre. La chiusura libera lo sportello e invia al CRM
   note e indirizzi dei media. Nel terminale del server compaiono le righe `[Media] file salvato: ...` e
   `[MOCK][Crm] notifyCheckIn {...}`; allo stesso modo, segnando un cliente assente dalla
   dashboard, compare `[MOCK][Crm] notifyNoShow {...}`.
6. Nella dashboard di accettazione, il clic sulla pratica apre il pannello con la sezione
   **Ispezione al veicolo**: le note, i video e le foto, raggruppati per parte del veicolo e
   apribili con un clic (il video parte nel riquadro a schermo intero).

Il CRM non può bloccare l'officina: se non risponde (`MOCK_CRM_MODE=error`) l'accettazione si
chiude lo stesso e l'evento resta nella coda di uscita, pronto per il rinvio. Con
`MEDIA_STORAGE_DIR` si sposta la cartella dei file; con `MEDIA_STORAGE_PROVIDER=memory` si torna
allo storage in memoria delle prime demo (e `MOCK_MEDIA_LATENCY_MS` ne regola l'attesa simulata).

### La stessa app al banco e sul piazzale

L'applicazione è una sola: cambia il comportamento, non l'interfaccia. Il criterio è il
**dispositivo**, non la larghezza dello schermo: un tablet si riconosce dal puntatore touch
(`pointer: coarse`), così un iPad in orizzontale resta un tablet anche se è più largo di un monitor.

- **Su tablet o telefono** "Prendi in carico" porta subito alla schermata di ispezione del veicolo, e il tocco su una riga apre i dettagli in una **finestra centrale** ariosa (codice
  e targa grandi, campi a due colonne, pulsante Chiudi a tutta larghezza) pensata per il dito. Dal
  dettaglio di una pratica in carico si passa al check-in con **Passa al check-in fotografico**.
  Foto e video restano facoltativi: il pulsante di chiusura non si blocca mai.
- **Su PC** "Prendi in carico" cambia lo stato e apre il pannello laterale del cliente: si resta
  sulla coda e non compare nessun pulsante di check-in o fotocamera. La voce "Tablet" non c'è nel
  menu e la pagina `/check-in`, se aperta a mano, spiega che il check-in si fa dal tablet.

Dall'ispezione si esce con **Salta per ora**, che riporta alla coda lasciando la pratica in
carico e i media già acquisiti nel fascicolo: se piove o la vettura va spostata subito, il check-in
si riprende dopo dalla scheda "Le mie prese in carico".

La coda è tarata anche per il dito: righe alte, pulsanti di almeno 44 × 44 px e riga interamente
toccabile per aprire il dettaglio.

### Tablet e iPad: bersagli e larghezze

I controlli principali rispettano il bersaglio minimo di 44×44 px: campi di testo e menu a tendina
(44 px), voci di navigazione e «Esci» nell'header, pulsanti di azione delle righe e del cruscotto BDC,
caselle di spunta da 24 px con etichette alte 44 px. A 768 px (iPad verticale) e 1024 px
(orizzontale) la pagina non scorre mai in orizzontale: le tabelle larghe scorrono dentro il proprio
riquadro e la coda nasconde le colonne Sportello e Operatore sotto i 1024 px (si leggono nel
dettaglio). Nel check-in i comandi **+ Foto** e **▶ Video** sono alti 56 px, sopra il minimo di 44.

Sui tablet piccoli (8-10 pollici) contano soprattutto due cose. Le **schede delle pratiche** nel
tablet hanno tre blocchi separati e respirati (codice, targa e ora; veicolo e cliente; lavorazione
richiesta) e il comando **Inizia check-in** in fondo, alto 64 px e a tutta larghezza, staccato dal
testo da un bordo: non si preme per sbaglio leggendo la scheda. Le **descrizioni lunghe** che
arrivano da Infinity (una sola può superare le venti righe) si fermano a due righe e si aprono con
"Mostra tutto" nel tablet, mentre in coda sono troncate con i puntini e per intero nel dettaglio.
Senza quel limite una riga sola occupava mezzo schermo e spingeva fuori vista tutte le altre. I badge «In diretta» e «Dati non aggiornati» stanno nella barra dei comandi, che va a
capo invece di sovrapporsi.

### Provare il cruscotto BDC

Il cruscotto BDC è **solo l'elenco dei clienti assenti**: chi non si è presentato, da richiamare e
da riprogrammare su Infinity. Niente statistiche, niente medie, niente grafici e nemmeno la
chiusura di giornata: stanno tutti in Amministrazione. Serve un account con ruolo responsabile: `responsabile` / `demo`. Dalla dashboard
di accettazione segna assente un cliente del blocco **In ritardo / assenti**, poi apri
<http://localhost:3000/manager>: la riga compare subito nel cruscotto con nome, numero richiamabile
con un tocco, targa, veicolo, motivo e ora dell'assenza. **Gestito / riprogrammato** chiude il lead quando
l'appuntamento è di nuovo in agenda su Infinity, e la riga esce dall'elenco delle chiamate da fare.
Chiede un secondo tocco ("Confermi? Esce dalla lista"), perché la lista si scorre con il telefono in
mano e il primo tocco parte da solo; la richiesta decade da sola dopo qualche secondo. Con **Con
nota** si aggiunge l'esito, per esempio "richiama lunedì". La spunta _Mostra anche i già gestiti_ fa
rivedere chi ha chiuso e quando, e da lì **Riporta fra i da fare** rimette il cliente in elenco:
serve dopo un tocco sbagliato o una riprogrammazione che poi salta.

La chiusura del lead è indipendente dal CRM: con `MOCK_CRM_MODE=error` la riga dice "CRM non
raggiungibile", ma il BDC può comunque telefonare e chiudere: l'evento resta in coda per il rinvio.

### Provare il portale cliente

Il portale si apre su <http://localhost:3000/qr> (alias breve di `/cliente`, adatto ai cartelli con
il QR code) oppure direttamente su `/portal?targa=AB123CD`, l'indirizzo che il cliente riceve via
WhatsApp (con in più `&t=<token>`, il token unico della pratica che apre la pagina senza login e
senza limiti di frequenza).

La schermata mobile è pensata per chi aspetta **in auto, in fila** davanti all'officina e guarda lo
schermo due secondi ogni tanto, e cambia
aspetto con lo stato: **in attesa** è bianca e blu, calma, perché non c'è niente da fare;
**chiamato** diventa verde, con il bordo spesso e un alone che respira attorno alla lettera dello
sportello, così il passaggio si nota senza leggere una parola (chi ha chiesto meno movimento al
sistema operativo vede l'alone fermo). In alto codice e targa, poi la **barra di avanzamento** a
quattro tappe (In attesa → In accettazione → In lavorazione → Pronta per il ritiro), e al centro
**un solo numero grande**, che cambia significato con lo stato: mentre si aspetta è la posizione in
fila ("Sei il numero 3 in fila", con le auto davanti sotto), quando tocca a lui è la **lettera
dello sportello** ("Tocca a te · SPORTELLO A"). I testi danno per scontata la scena vera: il
cliente non è seduto in una sala, è **in auto, in fila** davanti all'officina, quindi si aspetta in
auto e si avanza verso lo sportello. In dashboard la stessa cosa si legge sulla riga: "in fila
dalle 10:32". Mai due numeri grandi insieme: davanti a un "3" e a una "B" della stessa dimensione nessuno
capisce quale contare. Sotto, la **riga del tempo** con tre orari — arrivo registrato, chiamata
allo sportello, orario previsto — che risponde alla domanda di chi aspetta, "da quanto sono qui e
quando tocca a me". Chiudono la pagina targa, accettatore, sede e due pulsanti. **"Sono arrivato, sono in fila"** registra
l'ora dell'arrivo: la pratica resta al suo posto in coda (l'ordine lo decidono l'orario e
l'accettatore, non chi tocca per primo), in dashboard compare "in sala dalle HH:mm" e il pulsante
lascia il posto alla conferma. È lo stesso gesto della risposta «Arrivato» su WhatsApp, e vale
anche quando la messaggistica è in standby. **"Sto arrivando in ritardo (+10 min)"** avvisa
l'accettazione (avviso ambra sulla riga della dashboard, nessuna telefonata) senza cambiare codice
né posizione in coda. Una
targa sconosciuta, un token non valido o una pratica conclusa da oltre 24 ore mostrano una
schermata cortese al posto della coda. Serve una targa presente nell'agenda del giorno: le targhe
finte sono generate in modo deterministico dal seme dei mock **e dalla data**, quindi cambiano ogni
giorno. Per leggere quelle di oggi apri la dashboard e copia una targa dalla colonna Targa, oppure
interroga l'API:

```bash
curl -s -c /tmp/c.txt -H 'content-type: application/json' -d '{"username":"mario.rossi","password":"demo","workstationId":"ws-p2"}' http://localhost:3000/api/v1/auth/login >/dev/null && curl -s -b /tmp/c.txt 'http://localhost:3000/api/v1/queue?view=global'
```

Per provare la pagina senza passare da un messaggio WhatsApp, in sviluppo c'è una scorciatoia: con
`DEV_QUICK_LOGIN=true` il dettaglio di una pratica in dashboard mostra il collegamento ambra **Apri
il tracciamento cliente (solo sviluppo)**, che apre `/portal?targa=…` in una scheda nuova. In
produzione non compare.

Con la dashboard aperta su una postazione e il portale su un'altra scheda, ogni azione
dell'operatore si riflette sulla schermata del cliente entro cinque secondi.

## Aggiornamenti in tempo reale

Coda, tabellone e monitor non aspettano il prossimo giro di aggiornamento: restano collegati a un
flusso di eventi (SSE) e si aggiornano nell'istante in cui qualcosa cambia — misurato in officina
simulata, circa 250 ms contro i 2 secondi del solo polling. Il polling resta comunque attivo come
rete di sicurezza: se il flusso cade, gli schermi rallentano ma non si fermano, e la dashboard lo
dice con l'etichetta **In diretta** / **Aggiornamento periodico**.

Sul flusso viaggiano segnali, non dati: "è cambiata una pratica", e chi riceve rilegge dal proprio
endpoint. Per questo esistono due canali — `/api/v1/events/stream` per l'area operatore e
`/api/v1/public/events/stream` per gli schermi pubblici, che ricevono solo il tipo dell'evento e
nessun identificativo.

Sul canale operatore viaggia anche quello che fa il **cliente**: "sono arrivato" e "sto arrivando in
ritardo". Coda del banco e vista tablet li ascoltano entrambe, quindi la riga si aggiorna da sola —
compare "in sala dalle HH:mm" — senza che l'accettatore ricarichi la pagina con le mani sporche.

## Il giro di WhatsApp: promemoria, risposte del cliente e tracciamento

> **In standby dal 2026-09-17.** Con `MESSAGING_STANDBY=true` (impostato in `.env.local`) tutta
> l'integrazione con il cliente è in pausa: nessun promemoria programmato, nessun messaggio guidato
> dagli eventi, webhook delle risposte che risponde 404. Il codice resta dov'è e nulla dipende dalle
> credenziali Spoki: l'officina lavora, i log non si riempiono di invii che nessuno voleva. Per
> riaccendere basta togliere la variabile e riavviare. Quello che segue descrive il comportamento a
> integrazione accesa.

**In uscita** l'integrazione Spoki manda due promemoria e una risposta:

- **Giorno prima** (alle `REMINDER_PREVIOUS_DAY_HOUR_LOCAL`, predefinito 18:00): il sistema
  anticipa la sincronizzazione dell'agenda di domani, così ogni pratica ha già il suo codice, e
  scrive a chi è in attesa domani con data, orario, targa, codice (es. F041) e link al portale.
- **Giorno stesso** (alle `REMINDER_SAME_DAY_HOUR_LOCAL`, predefinito 07:30, dopo la sync): a chi è
  in coda oggi arrivano orario, targa, codice e **tre risposte rapide**: «Arrivato», «In ritardo»,
  «Assente». I pulsanti stanno nel template Spoki; il testo che li accompagna vale anche per l'SMS
  di ripiego, dove si risponde scrivendo.
- **Conferma di arrivo**, appena il cliente tocca «Arrivato»: il suo codice e il link alla pagina di
  tracciamento. È così che oggi il cliente arriva alla pagina, senza inquadrare nessun QR.

I promemoria sono idempotenti per pratica e giornata e si possono lanciare anche da un cron esterno
(`POST /api/v1/system/cron/reminders?kind=previous-day|same-day` con `x-cron-secret`).

**In entrata** le tre risposte tornano su `POST /api/v1/webhooks/spoki`, autenticato con il segreto
condiviso `SPOKI_INBOUND_SECRET` (nel corpo `secret` o nell'intestazione `x-spoki-secret`; senza
segreto configurato la rotta risponde 404). Ogni risposta diventa un fatto dell'officina:

| Risposta       | Cosa succede                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| **Arrivato**   | Si annota l'ora dell'arrivo, la pratica resta al suo posto in coda e parte la risposta con codice e link  |
| **In ritardo** | Come il pulsante del portale: l'arrivo atteso si sposta di 10 minuti e la dashboard mostra l'avviso ambra |
| **Assente**    | La pratica diventa assente e finisce nel cruscotto BDC, con scritto che è stato il cliente a dirlo        |

Il webhook è prudente per costruzione: un testo che non è una delle tre risposte, o un numero senza
pratica in agenda oggi, riceve `200 {"handled": false}` e non tocca niente — sul numero
dell'officina arriva di tutto, e un «grazie» non deve segnare nessuno come assente. Un secondo
tocco sullo stesso pulsante non sposta l'ora già registrata e non manda un secondo messaggio.

**Guardrail anti-invio.** Nessun cliente reale riceve un WhatsApp finché `SPOKI_MODE` non è `live`
**e** `SPOKI_SAFETY_LOCK` non è `false` (predefinito `true`). Con il blocco attivo l'adapter non
apre alcuna connessione: formatta il payload nel formato Spoki (`secret`, `phone` in E.164,
`first_name`, `last_name`, `email`, `custom_fields` con `code`, `plate`, `time`, `date`,
`portal_url`), lo scrive nel log e nel registro del pannello, e risponde come se fosse andato.
Il file `.env.local` di sviluppo tiene `SPOKI_PROVIDER=real`, `SPOKI_MODE=simulation`,
`SPOKI_SAFETY_LOCK=true` con gli URL e i segreti delle due automazioni
(`SPOKI_URL_REMINDER_PREVIOUS_DAY`, `SPOKI_SECRET_REMINDER_PREVIOUS_DAY`,
`SPOKI_URL_REMINDER_SAME_DAY`, `SPOKI_SECRET_REMINDER_SAME_DAY`).

**Consenso WhatsApp.** L'anagrafica Infinity non porta un opt-in WhatsApp, quindi di norma un cliente
senza consenso riceve l'SMS. Con `SPOKI_OVERRIDE_CONSENT=true` i promemoria, che sono comunicazioni di
servizio su un appuntamento già preso, tentano comunque WhatsApp (con lo stesso ripiego SMS in caso
di errore); il pannello lo segnala con «consenso: override di servizio». Il guardrail degli invii reali
non cambia: in simulazione o con il blocco attivo non parte nulla.

In `/admin/spoki-test` (e nella stessa sezione di `/admin`) l'amministratore vede provider,
modalità, blocco di sicurezza, stato di URL e segreti, e può fare un **invio test manuale** dei due
promemoria a un numero **digitato a mano**: le liste clienti non si usano e il numero di un cliente
in agenda viene rifiutato. Il **registro dei payload** mostra ogni messaggio con il motivo del
blocco (simulazione o safety lock) e il segreto mascherato. `PUBLIC_BASE_URL` è l'indirizzo
pubblico usato nei link dei messaggi.

## Il planning di Infinity dal database reale (ODBC)

Il gestionale Zucchetti Infinity gira su SQL Anywhere 12. L'adapter `InfinityServiceOdbc`
(`src/infrastructure/adapters/infinity/`) legge il **Planning Appuntamenti Clienti** in sola
lettura attraverso il DSN ODBC di sistema già configurato sul server, e restituisce la stessa
agenda che oggi produce il mock: sync, coda e dashboard non sanno da dove arrivano i dati.

- `INFINITY_ODBC_DSN=Infinity02` è la copia di prova; per la produzione basta `Infinity01`.
  `INFINITY_DB_TYPE=sql_anywhere_12`; credenziali nel DSN (o in `INFINITY_ODBC_UID/PWD`, mai nel
  repository); `INFINITY_BOOKING_DOC_TYPES=PR01` sceglie i tipi documento dell'officina.
- La testata del planning arriva dalla stessa procedura che usa Infinity (`sp_off_docs_planning`,
  serve un `GRANT EXECUTE` all'utenza del DSN) oppure, se non è concessa, dalle tabelle:
  `INFINITY_PLANNING_SOURCE=auto` sceglie da solo e avvisa nel log. Nome cliente, cellulare,
  lavorazioni con ore stimate, modello e stato (annullata, chiusa) si leggono in entrambi i casi.
- `npm run infinity:check` (con `INFINITY_ODBC_DSN` nell'ambiente, e `INFINITY_ODBC_DATE` per una
  giornata diversa da oggi) stampa a terminale la connessione, la **verifica dei permessi** con i
  `GRANT` da richiedere all'IT del gestionale e il planning letto davvero: ora, documento, targa,
  cliente, telefono mascherato, veicolo, accettatore, stato, ore, lavorazioni, note.
- `INFINITY_PROVIDER=real` attiva l'adapter nell'applicazione; richiede `SESSION_SECRET` e il profilo
  di seed `real` (vedi «Account dimostrativi»). Dal 2026-09-16 l'app di sviluppo gira così sui dati
  veri di `infinity01`: la coda del giorno è il planning dell'officina di Bari.

Mappatura delle tabelle, analisi della query nativa del planning, permessi e `GRANT`, limiti
riscontrati su `infinity02` (targhe solo dagli invii FAL) e procedura per `infinity01` sono in
[`docs/INFINITY_ODBC.md`](docs/INFINITY_ODBC.md).

## Quando qualcosa va storto

**Infinity non risponde.** La porta verso il DMS è avvolta da un interruttore di circuito: dopo tre
guasti di rete consecutivi il sistema smette di chiamarlo per un minuto (l'health check lo dice:
"circuito aperto"), poi fa una sola chiamata di prova e, se risponde, riparte. Una sincronizzazione
fallita viene ritentata da sola dopo 2, 5, 10 e 30 minuti; se anche l'ultimo tentativo fallisce
resta il pulsante **Riprova sync** in dashboard. Nel frattempo l'officina lavora sulla coda che ha.

**Un provider di messaggi non risponde.** I messaggi al cliente partono dagli eventi (pratica
inserita a mano, turno che si avvicina, annullamento deciso da una persona) e sempre fuori dal
percorso della richiesta che li ha generati: la presa in carico non aspetta WhatsApp. Il ripiego
WhatsApp → SMS → contatto manuale resta quello del promemoria del mattino.

**Una schermata va in errore.** L'area operatore mostra il problema dentro l'applicazione, con
"Riprova" e "Torna alla coda"; un monitor mostra uno schermo giallo "MONITOR IN RIPRISTINO" e si
riavvia da solo dopo venti secondi.

## Perimetro pubblico

Portale QR, tabellone e monitor sono pubblici e devono restarlo. Per questo il canale pubblico può
solo **leggere**: nessuna rotta sotto `/api/v1/public/` accetta mutazioni, gli identificativi sono
UUID non enumerabili, il portale cerca per targa e le risposte non contengono nomi né telefoni.
Ogni rotta pubblica ha un limite di frequenza; il flusso eventi ha un tetto alle connessioni aperte
per indirizzo (oltre, 503 e lo schermo resta sul polling). Il login ha un limite per indirizzo e
per utente (429 con `Retry-After`). I segreti — token dei monitor, chiave del cron — si
confrontano a tempo costante, e con `DISPLAY_TOKEN_REQUIRED=true` i monitor devono presentare il
proprio token. Le risposte portano le intestazioni di sicurezza standard (niente sniffing del
tipo, niente inclusione in pagine esterne, fotocamera solo per la stessa origine).

## Fine giornata e coda verso il CRM

**Chiusura giornata.** A officina chiusa l'amministratore preme _Esegui chiusura giornata_ nella
vista **Amministrazione**, accanto alle statistiche, e conferma. Dal 2026-09-17 il comando non sta
più nel cruscotto BDC: chiudere la giornata è un atto di supervisione, e chi telefona ai clienti
assenti quella lista se la ritrova già fatta. Chi era ancora in coda viene segnato **assente** e compare subito fra i
lead da ricontattare (con l'evento verso il CRM); le accettazioni rimaste **in carico** vengono
chiuse **d'ufficio**: risultano completate ma "da confermare", perché a quell'ora un veicolo in
carico è quasi sempre stato accettato senza il tocco finale. La mattina dopo il responsabile le
trova segnate in coda, nel dettaglio e nel CSV; le conferma ("Conferma chiusura", e il CRM riceve
il check-in) oppure un operatore le riapre e conclude il giro. Le pratiche già completate non si
toccano. Monitor e tabellone tornano vuoti da soli: le loro viste
derivano dalle pratiche aperte, non da uno stato salvato a parte.

**Chiusura automatica.** Se nessuno preme il pulsante, ci pensa il sistema: dopo
`BUSINESS_DAY_END_TIME` (default `19:00`) lo scheduler della giornata chiude quello che è rimasto
aperto, una volta sola e solo se serve. Nel registro degli eventi la chiusura automatica risulta
come azione di sistema, non di un operatore.

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

## Amministrazione, archivio foto e retention

`/admin` è organizzata in **quattro schede**, nell'ordine delle domande che un amministratore si
fa, dalla più frequente alla più rara. La scheda aperta sta nell'indirizzo (`?sezione=`), quindi un
collegamento salvato riporta dove si era:

| Scheda               | Cosa contiene                                                           |
| -------------------- | ----------------------------------------------------------------------- |
| **Oggi**             | La fila adesso e le statistiche della giornata, con l'esportazione CSV  |
| **Monitoraggio**     | I quattro sportelli, la coda globale in sola lettura, le pratiche ferme |
| **Sistema**          | Chiusura della giornata e integrazione con il cliente (Spoki)           |
| **Utenti e accessi** | Tutti gli account del sistema, con le azioni sulla riga                 |

**Utenti e accessi.** Un elenco solo per tutti gli account — accettatori, BDC, amministratori e
dispositivi kiosk — con nome, utente, ruolo, sportelli assegnati e stato, e le azioni sulla riga.
_Nuovo operatore_
chiede nome utente (minuscolo, senza spazi), nome da mostrare, ruolo, sportelli, postazione
abituale e password iniziale (almeno 8 caratteri); _Modifica_ cambia tutto tranne il nome utente;
_Disattiva_ è reversibile e non cancella nulla, così i registri restano leggibili. _Reset
password_ genera una provvisoria nel formato `XXXX-XXXX-XXXX`, senza caratteri ambigui perché va
dettata a voce, e la mostra una volta sola: da quel momento esiste solo il suo hash. Il server
rifiuta di disattivare o degradare chi sta operando e l'ultimo amministratore attivo: l'officina
non può restare chiusa fuori.

**Primo accesso e cambio password.** Un account appena creato, o appena azzerato, ha una password
che conoscono in due: finché l'operatore non la sostituisce può aprire soltanto la pagina
`/cambia-password`. Qualunque altra pagina lo rimanda lì e qualunque API risponde 403
`PASSWORD_CHANGE_REQUIRED`; anche un reset fatto mentre è collegato vale dalla richiesta
successiva. La nuova password deve avere almeno 8 caratteri ed essere diversa dall'attuale; la
pagina è raggiungibile anche di propria iniziativa. Nel pannello la riga mostra "Password
provvisoria" finché il cambio non è avvenuto.

**La fila adesso.** La vista Amministrazione apre con quattro numeri in tempo reale, aggiornati da
soli ogni dieci secondi: **auto in fila** (quante aspettano fuori, e quante hanno dichiarato di
essere arrivate), **attesa media ora**, **attesa più lunga** e **pratiche agli sportelli**. Le
attese si contano da quando il cliente ha toccato "sono arrivato", non dall'orario di prenotazione:
quello dice quando era atteso, non da quanto sta aspettando davvero. Se nessuno si è ancora
annunciato resta un trattino, perché una media inventata è peggio di un buco. Oltre i venti minuti
di media il riquadro diventa ambra: è il momento di aprire un altro sportello.

**Sportelli e monitoraggio.** L'amministratore non siede a un banco, quindi "guarda la coda" è una
domanda con quattro risposte. La scheda **Monitoraggio** le mette in fila in un blocco solo: i
quattro sportelli, ognuno con chi è collegato, cosa sta lavorando e le sue azioni (guarda la coda,
scollega, libera), più la **coda globale**. Scegliendo uno sportello si apre la coda della sua area
per marchio (A e B condividono la coda FCA, C e D quella PSA); scegliendo la coda globale si apre
tutta l'officina **in sola lettura**, con una fascia che lo dice e nessuna azione sulle righe, per
non toccare per sbaglio il lavoro di chi è al banco. Fino al 2026-09-17 la stessa griglia A-B-C-D
compariva due volte, una per scegliere e una per sbloccare: ora è una sola.

**Scollega uno sportello.** Fine turno, l'accettatore spegne il monitor e va a casa senza uscire
dall'applicazione: il posto resta suo e il collega del turno dopo non può sedersi. Accanto al nome
dell'operatore c'è **Scollega**, con conferma al secondo tocco perché butta fuori una persona.
Libera solo l'occupazione del posto: la pratica eventualmente in carico su quello sportello **non
viene toccata** — un veicolo accettato a metà non si chiude per un problema di sessioni — e resta
lì, sbloccabile con "Rimetti in coda" nella stessa schermata. Chi è stato scollegato se ne accorge
al primo clic: la sua sessione non vale più e torna al login, dove rientra su uno sportello libero.

**Assistenza.** Sotto c'è una scheda per sportello con le due informazioni che servono da lontano:
**a chi è assegnato** (l'operatore collegato a quella postazione, con l'ora del collegamento) e
**cosa sta facendo adesso** ("In lavorazione: AB123CD · pratica F001" oppure "Libero · in attesa del
prossimo cliente"). Sono cose diverse: uno sportello può avere un accettatore collegato e nessuna
pratica, oppure una pratica ferma e nessuno collegato, e in quel secondo caso c'è qualcosa da
sbloccare. Seguono tutte le pratiche in carico. _Libera sportello_ e _Rimetti in coda_ fanno la
stessa cosa (la pratica torna in attesa, l'accettazione si libera) e sono reversibili, quindi
bastano un tocco; _Annulla pratica_ chiude definitivamente e chiede un secondo tocco.

**Archivio ispezioni.** Da _Archivio_ nell'intestazione si cerca un check-in per targa (anche
scritta con spazi o in minuscolo) o per codice pratica: la scheda mostra veicolo, cliente, stato,
note e le foto raggruppate per parte del veicolo. Serve al ritiro, quando un cliente contesta un
danno.

**Retention.** Ogni foto e ogni video nascono con una scadenza: `MEDIA_RETENTION_DAYS` giorni,
**90 di default** (tre mesi: i tempi dell'officina sono questi, fra una lavorazione lunga, un
ricambio che tarda e un cliente che contesta un graffio settimane dopo il ritiro). Si cambia da
`.env.local` senza toccare il codice, e la pulizia resta automatica: nessun operatore deve
ricordarsi di cancellare niente. Con i video, che pesano fino a 80 MB l'uno, conviene guardare lo
spazio su disco prima di allungare ancora. Dopo la chiusura della giornata lo scheduler elimina i
file scaduti e marca il record come archiviato: la scheda resta con data, categorie e note e al
posto della foto compare "file eliminato". Dopo altri `MEDIA_HARD_DELETE_DAYS` giorni (default 90,
contati dall'archiviazione) anche la scheda viene eliminata dal database. I vecchi nomi
`PHOTO_RETENTION_DAYS` e `PHOTO_HARD_DELETE_DAYS` continuano a funzionare, ma i nuovi hanno la
precedenza. Lo stesso lavoro
si può affidare a un cron esterno con `POST /api/v1/system/cron/media-retention` (sessione
amministratore o header `x-cron-secret`); la risposta riporta file archiviati, record eliminati
e file **protetti**.

**Il tempo da solo non basta.** Un file scaduto viene eliminato solo se la pratica lo permette,
con tre condizioni in **and**: la retention è trascorsa, la commessa risulta **chiusa**
(`orderClosedAt`, oppure pratica assente o annullata — mai entrata in officina, nessuna commessa),
e non c'è un **vincolo legale** (`legalHoldAt`). Un'auto ferma quattro mesi per un ricambio ha la
commessa aperta e il suo video di check-in resta; un contenzioso mette il vincolo e i media non si
toccano finché l'amministratore non lo toglie. Entrambi gli interruttori stanno nel pannello di
dettaglio della pratica, visibili solo all'amministratore, e passano da
`PATCH /api/v1/admin/appointments/:id/retention`. Attenzione: «Chiusa in ODL» in Infinity è
l'**apertura** dell'ordine di lavoro, non la chiusura della commessa — per questo oggi la chiusura
la dichiara l'amministratore; quando la lettura da Infinity (`tdo_cli`, data di consegna
effettiva) sarà collegata, lo farà la sincronizzazione. I file protetti restano sul disco e si
riesaminano al giro successivo: il riepilogo del cron li conta per motivo, così se il disco non
si svuota si sa perché.

## Statistiche ed esportazione

La vista **Amministrazione** apre con il riquadro **Statistiche del giorno**: attesa media (dal
momento in cui il cliente era atteso alla presa in carico), durata media dell'accettazione (dalla
presa in carico alla chiusura) ed esito della giornata in percentuale — completate, assenti,
annullate. Accanto a ogni media c'è su quante pratiche è calcolata: una media su tre pratiche non
è un indicatore.

Dal 2026-09-17 i numeri della giornata sono **riservati all'amministratore**, insieme
all'esportazione CSV: `GET /api/v1/reports/daily` e la sua variante CSV rispondono 403 a chiunque
altro, responsabile compreso. Al BDC serve sapere chi richiamare adesso, non la media di attesa.

**Esporta report CSV** scarica il dettaglio di tutte le pratiche della giornata (codice, orari,
targa, veicolo, cliente, sportello, accettazione, stato, operatore, minuti di attesa e di
lavorazione, foto, note). Il file usa il punto e virgola e la virgola decimale: Excel italiano lo
apre con un doppio clic.

## Mappa delle rotte

Tutte le pagine e le API dell'applicazione, con descrizione e livello di accesso. La tabella è
generata da `npm run rotte -- --readme` a partire da `scripts/mappa-rotte.mjs`, che legge `src/app`
e la incrocia con l'elenco curato delle descrizioni; `npm run rotte` la stampa a console e il test
`tests/unit/mappa-rotte.test.ts` fallisce se una rotta nuova non è descritta o se il README è
indietro. I livelli: **Pubblico** (nessuna sessione), **token del monitor** (`?token=`, obbligatorio
con `DISPLAY_TOKEN_REQUIRED=true`), **Sessione operatore** (Accettatore, Manager, Amministratore),
**Manager e Amministratore**, **Solo Amministratore**, **Amministratore oppure `x-cron-secret`**
per i cron esterni.

<!-- mappa-rotte:inizio -->

### Accesso e sessione

| Rotta              | Metodo | Descrizione                                                                                           | Accesso                                            |
| ------------------ | ------ | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `/`                | pagina | Radice: smista alla home del ruolo (accettazione, manager, admin, tabellone per i kiosk) o al login.  | Pubblico                                           |
| `/login`           | pagina | Login dell'operatore: credenziali e scelta dello sportello (Sportello A · FCA, con i marchi serviti). | Pubblico                                           |
| `/cambia-password` | pagina | Cambio password, obbligato dopo creazione account o reset, oppure volontario.                         | Sessione operatore, anche con password provvisoria |

### Dashboard accettazione e postazioni operatore

| Rotta                    | Metodo | Descrizione                                                                                                                                                                                                     | Accesso                                                           |
| ------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `/accettazione`          | pagina | Coda della giornata per sportello e vista globale: prendi in carico, salta, completa, riattiva, inserimento manuale, riprova sync. Con ?sola-lettura=1 (solo amministratore) diventa monitoraggio senza azioni. | Accettatore e Amministratore (il BDC resta sul proprio cruscotto) |
| `/accettazione/archivio` | pagina | Archivio dei check-in con foto e video: ricerca per targa o codice pratica.                                                                                                                                     | Accettatore e Amministratore (il BDC resta sul proprio cruscotto) |

### Tablet e check-in veicolo

| Rotta       | Metodo | Descrizione                                                                                                                                                                    | Accesso                                                           |
| ----------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `/check-in` | pagina | Vista tablet a tutto schermo: pratiche in attesa del mio sportello, prese in carico, video obbligatorio e foto facoltative, conclusione con conferma. Da PC rimanda alla coda. | Accettatore e Amministratore (il BDC resta sul proprio cruscotto) |
| `/tablet`   | pagina | Vecchio indirizzo del tablet: rimanda a /check-in conservando la pratica richiesta.                                                                                            | Accettatore e Amministratore (il BDC resta sul proprio cruscotto) |

### Manager e BDC

| Rotta      | Metodo | Descrizione                                                                        | Accesso                  |
| ---------- | ------ | ---------------------------------------------------------------------------------- | ------------------------ |
| `/bdc`     | pagina | Alias dell'indirizzo usato dal reparto: rimanda al cruscotto BDC (/manager).       | Manager e Amministratore |
| `/manager` | pagina | Cruscotto BDC: solo i clienti assenti da ricontattare e riprogrammare su Infinity. | Manager e Amministratore |

### Amministrazione e configurazione

| Rotta               | Metodo | Descrizione                                                                                                                                                                                                 | Accesso             |
| ------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `/admin`            | pagina | Statistiche della giornata con esporta CSV, chiusura della giornata operativa, operatori (crea, modifica, disattiva, reset password), assistenza (sportelli occupati, pratiche ferme) e integrazione Spoki. | Solo Amministratore |
| `/admin/spoki-test` | pagina | Prova controllata dei due promemoria WhatsApp verso un numero digitato a mano; registro dei payload.                                                                                                        | Solo Amministratore |

### Sistema e diagnostica

| Rotta      | Metodo | Descrizione                                                                                                       | Accesso                                                           |
| ---------- | ------ | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `/sistema` | pagina | Stato delle porte esterne (Infinity, Spoki, SMS, CRM); per l'amministratore anche la coda di uscita verso il CRM. | Accettatore e Amministratore (il BDC resta sul proprio cruscotto) |

### Display di sala e monitor delle campate

| Rotta                  | Metodo | Descrizione                                                                                                                                     | Accesso                                                                                |
| ---------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `/display/sala-attesa` | pagina | Tabellone della sala d'attesa: codici chiamati con la lettera dello sportello e prossimi turni (`?prossimi=`). Home degli account kiosk.        | Pubblico · token del monitor (`?token=`, obbligatorio con DISPLAY_TOKEN_REQUIRED=true) |
| `/display/:campata`    | pagina | Monitor sopra lo sportello (/display/A … /display/D, valgono anche 1…4): lettera dello sportello, codice e targa della vettura in accettazione. | Pubblico · token del monitor (`?token=`, obbligatorio con DISPLAY_TOKEN_REQUIRED=true) |

### Portale cliente (live tracking)

| Rotta            | Metodo | Descrizione                                                                                                                                                                        | Accesso  |
| ---------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `/portal`        | pagina | Tracciamento del cliente dal link WhatsApp o dal QR (`?targa=` e `&t=` token): posizione in fila, lettera dello sportello, orari di arrivo e chiamata, "Sto arrivando in ritardo". | Pubblico |
| `/cliente`       | pagina | Ingresso dal QR code: ricerca per targa.                                                                                                                                           | Pubblico |
| `/cliente/stato` | pagina | Esito della ricerca per targa: la stessa schermata del portale.                                                                                                                    | Pubblico |
| `/qr`            | pagina | Alias corto stampato sui cartelli: rimanda a /cliente (con `?src=` corsia).                                                                                                        | Pubblico |

### API: autenticazione

| Rotta                          | Metodo | Descrizione                                                                                                                       | Accesso                                            |
| ------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `/api/v1/auth/login`           | POST   | Verifica credenziali e postazione, imposta il cookie di sessione (limiti di frequenza per IP e utente).                           | Pubblico                                           |
| `/api/v1/auth/logout`          | POST   | Libera la postazione e cancella il cookie.                                                                                        | Sessione operatore, anche con password provvisoria |
| `/api/v1/auth/me`              | GET    | Sessione corrente (ruolo, postazione, obbligo di cambio password).                                                                | Sessione operatore, anche con password provvisoria |
| `/api/v1/auth/change-password` | POST   | Sostituisce la password (provvisoria o no) e rinnova il cookie.                                                                   | Sessione operatore, anche con password provvisoria |
| `/api/v1/auth/quick-login`     | POST   | Accesso veloce di sviluppo (DEV_QUICK_LOGIN): sessione di un profilo dev.* senza credenziali; 404 in produzione o se disattivato. | Pubblico                                           |

### API: coda e pratiche

| Rotta                               | Metodo    | Descrizione                                                                                                                                                                                     | Accesso                                                                                                |
| ----------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `/api/v1/queue`                     | GET       | Coda della giornata (`?date=&deskId=&view=desk oppure global`): righe arricchite, sportelli senza il token dei monitor, ultima sync, dati di riferimento. Polling della dashboard e del tablet. | Accettatore e Amministratore (il BDC resta sul proprio cruscotto)                                      |
| `/api/v1/appointments`              | POST      | Inserimento manuale di una pratica (cliente senza appuntamento) nella coda di oggi.                                                                                                             | Accettatore e Amministratore (il BDC resta sul proprio cruscotto)                                      |
| `/api/v1/appointments/:id/actions`  | POST      | Azioni sulla pratica: take, skip, complete, release, restore, no-show, reactivate, cancel, confirm-auto-close (con `expectedVersion`, 409 sui conflitti).                                       | Accettatore e Amministratore; `cancel`, `release` e `confirm-auto-close` solo Manager e Amministratore |
| `/api/v1/appointments/:id/check-in` | POST      | Conclude l'accettazione dal tablet: note dell'ispezione, chiusura pratica (serve il video del veicolo, le foto no), notifica al CRM.                                                            | Accettatore e Amministratore (il BDC resta sul proprio cruscotto)                                      |
| `/api/v1/appointments/:id/media`    | GET, POST | Media dell'ispezione: elenco (GET) e caricamento multipart di una foto o di un video dal tablet (POST, campo `foto`, `categoria` facoltativa).                                                  | Accettatore e Amministratore (il BDC resta sul proprio cruscotto)                                      |
| `/api/v1/media/:key`                | GET       | Rilegge una foto o un video dell'ispezione dallo storage.                                                                                                                                       | Accettatore e Amministratore (il BDC resta sul proprio cruscotto)                                      |
| `/api/v1/inspections/archive`       | GET       | Storico dei check-in con i media acquisiti (`?q=` targa o codice; vuoto = ultimi cinquanta).                                                                                                    | Accettatore e Amministratore (il BDC resta sul proprio cruscotto)                                      |
| `/api/v1/events/stream`             | GET       | Eventi in tempo reale (SSE) per l'area operatore: segnala cosa è cambiato, i dati si rileggono dagli endpoint.                                                                                  | Sessione operatore (Accettatore, Manager, Amministratore)                                              |
| `/api/v1/sync`                      | POST      | Sincronizzazione manuale dell'agenda Infinity di oggi.                                                                                                                                          | Manager e Amministratore; Accettatore solo come «Riprova» dopo una sync fallita o assente              |

### API: pubbliche (portale cliente, monitor, tabellone)

| Rotta                          | Metodo | Descrizione                                                                                                                                              | Accesso                                                                                 |
| ------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `/api/v1/health`               | GET    | Liveness del processo e stato aggregato delle quattro porte esterne (`?strict=` per il readiness).                                                       | Pubblico                                                                                |
| `/api/v1/public/status`        | GET    | Stato della pratica per il portale (`?targa=` o `?t=` token): tappa, posizione in coda, orario, accettatore, sede.                                       | Pubblico                                                                                |
| `/api/v1/webhooks/spoki`       | POST   | Risposte del cliente su WhatsApp (Arrivato, In ritardo, Assente): registra arrivo o ritardo, segna assente e risponde con codice e link al tracciamento. | Pubblico · segreto condiviso (`SPOKI_INBOUND_SECRET`); 404 con `MESSAGING_STANDBY=true` |
| `/api/v1/public/arrival`       | POST   | "Sono arrivato" dalla pagina di tracciamento: registra l'ora in cui il cliente si annuncia in sala, senza cambiare il posto in coda.                     | Pubblico                                                                                |
| `/api/v1/public/late-notice`   | POST   | "Sto arrivando in ritardo (+10 min)" dal portale: sposta l'arrivo atteso e avvisa la dashboard.                                                          | Pubblico                                                                                |
| `/api/v1/public/board`         | GET    | Dati del tabellone della sala d'attesa (`?prossimi=`).                                                                                                   | Pubblico                                                                                |
| `/api/v1/public/display`       | GET    | Stato del monitor di uno sportello (`?campata=A`, `?bay=`, `?bayCode=`): solo lettera, codice e targa.                                                   | Pubblico · token del monitor (`?token=`, obbligatorio con DISPLAY_TOKEN_REQUIRED=true)  |
| `/api/v1/public/events/stream` | GET    | Eventi in tempo reale (SSE) per monitor e tabellone: solo il tipo di evento, senza identificativi.                                                       | Pubblico                                                                                |

### API: manager, report e BDC

| Rotta                             | Metodo | Descrizione                                                                                                | Accesso                  |
| --------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------- | ------------------------ |
| `/api/v1/reports/daily`           | GET    | Indicatori della giornata (`?giornata=`): attesa media, durata, esiti.                                     | Solo Amministratore      |
| `/api/v1/reports/daily/csv`       | GET    | Riepilogo dettagliato della giornata in CSV (con BOM per Excel).                                           | Solo Amministratore      |
| `/api/v1/crm/leads`               | GET    | Clienti da ricontattare per il BDC (`?giornata=&gestiti=1`): nomi e telefoni degli assenti.                | Manager e Amministratore |
| `/api/v1/crm/leads/:id/reopen`    | POST   | Riporta un lead chiuso fra quelli da ricontattare (tocco sbagliato o riprogrammazione saltata).            | Manager e Amministratore |
| `/api/v1/crm/leads/:id/contacted` | POST   | Il BDC dichiara di aver ricontattato il cliente (chi, esito).                                              | Manager e Amministratore |
| `/api/v1/system/close-day`        | POST   | Chiusura della giornata: chi è in coda diventa assente (lead BDC), chi è in carico viene chiuso d'ufficio. | Manager e Amministratore |

### API: amministrazione

| Rotta                                        | Metodo    | Descrizione                                                                                                                                                       | Accesso             |
| -------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `/api/v1/admin/workstations/:id/eject`       | POST      | Scollega uno sportello rimasto occupato da chi ha finito il turno: libera il posto, non tocca la pratica in carico.                                               | Solo Amministratore |
| `/api/v1/admin/appointments/:id/retention`   | PATCH     | Conservazione dei media di una pratica (PATCH): vincolo legale e chiusura della commessa. Finché la commessa è aperta o c’è un vincolo, foto e video non scadono. | Solo Amministratore |
| `/api/v1/admin/operators`                    | GET, POST | Elenco (GET) e creazione (POST) degli operatori, con sportelli e postazioni per i menu.                                                                           | Solo Amministratore |
| `/api/v1/admin/operators/:id`                | PATCH     | Modifica di un operatore: nome, ruolo, sportelli, postazione predefinita, attivazione.                                                                            | Solo Amministratore |
| `/api/v1/admin/operators/:id/reset-password` | POST      | Nuova password provvisoria, restituita una sola volta.                                                                                                            | Solo Amministratore |
| `/api/v1/admin/assistance`                   | GET       | Accettazioni occupate e pratiche in carico da troppo tempo.                                                                                                       | Solo Amministratore |
| `/api/v1/admin/spoki`                        | GET       | Stato dell'integrazione WhatsApp (provider, modalità, safety lock, override consenso, template) e registro dei payload.                                           | Solo Amministratore |
| `/api/v1/admin/spoki/test`                   | POST      | Invio di prova di un promemoria a un numero digitato a mano (in simulazione finisce nel registro).                                                                | Solo Amministratore |
| `/api/v1/crm/outbox`                         | GET       | Coda di uscita verso il CRM, vista tecnica (`?stato=&limite=`).                                                                                                   | Solo Amministratore |
| `/api/v1/crm/outbox/:id/retry`               | POST      | "Forza riprova" di un evento verso il CRM.                                                                                                                        | Solo Amministratore |

### API: sistema e cron

| Rotta                                 | Metodo | Descrizione                                                                                                                | Accesso                                            |
| ------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `/api/v1/system/cron/reminders`       | POST   | Promemoria ai clienti (`?kind=previous-day oppure same-day`) per un cron esterno; stesso servizio dello scheduler interno. | Amministratore oppure intestazione `x-cron-secret` |
| `/api/v1/system/cron/crm-retry`       | POST   | Svuotamento della coda di uscita verso il CRM (rinvii) per un cron esterno.                                                | Amministratore oppure intestazione `x-cron-secret` |
| `/api/v1/system/cron/media-retention` | POST   | Eliminazione dei file di foto e video oltre la retention per un cron esterno.                                              | Amministratore oppure intestazione `x-cron-secret` |

<!-- mappa-rotte:fine -->

## Script disponibili

| Comando                    | Descrizione                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| `npm run dev`              | Server di sviluppo su <http://localhost:3000>                                                   |
| `npm run build`            | Build di produzione (output `standalone`)                                                       |
| `npm start`                | Avvio della build                                                                               |
| `npm run typecheck`        | TypeScript strict senza emissione                                                               |
| `npm run lint`             | ESLint (con guardia architetturale) e controllo encoding UTF-8/LF                               |
| `npm run format`           | Prettier su sorgenti, test e configurazioni                                                     |
| `npm test`                 | Test unitari con Vitest                                                                         |
| `npm run test:coverage`    | Test con copertura                                                                              |
| `npm run infinity:check`   | Lettura di prova del planning dal database Infinity reale (serve `INFINITY_ODBC_DSN`)           |
| `npm run seed:credenziali` | Genera i segreti del profilo di seed `real` da incollare in `.env.local`                        |
| `npm run rotte`            | Mappa di tutte le rotte con accesso; `npm run rotte -- --readme` aggiorna la sezione del README |

## Struttura del repository

```
src/
├── app/            Pagine e Route Handler Next.js (login, accettazione, archivio, tablet, manager, admin, sistema, api/v1)
├── application/    Casi d'uso: auth, queue, sync, health, notifications, crm, media (ispezione e archivio), reporting, admin
├── components/     UI riusabile (primitive in ui/, shell in layout/)
├── config/         Composition root: env, seed, auth, container, infinity (config dell'adapter reale)
├── domain/         Entità, value object, state machine, eventi (codice puro)
├── hooks/          Hook React (polling della coda, azioni)
├── infrastructure/ Adapter reali: adapters/infinity (ODBC verso SQL Anywhere), messaging/spoki
├── lib/            Utilità: date, hash password, client API, helper HTTP
├── modules/        Componenti di modulo (reception, customer-portal, bay-displays, inspection-media, crm, admin)
├── repositories/   Interfacce di persistenza e implementazione in memoria
└── services/       Porte esterne, DTO, mapper e Mock (Infinity, Spoki, SMS Hosting, CRM)
tests/              Test unitari, di contratto e di integrazione (Vitest)
```

## Documentazione

- [`ARCHITECTURE.md`](ARCHITECTURE.md): stack, Regola d'Oro Mock-First, modello di dominio, decisioni.
- [`TASKS.md`](TASKS.md): piano di lavoro per milestone (M0 bootstrap → M7 passaggio ai servizi reali).
- [`docs/ANALISI_REQUISITI.md`](docs/ANALISI_REQUISITI.md): requisiti e flussi operativi.
- [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md): colore, densità, primitivi e regole dell'interfaccia — da leggere prima di scrivere una schermata nuova.
- [`docs/AUDIT_PRODUZIONE.md`](docs/AUDIT_PRODUZIONE.md): cosa manca per la produzione, casi limite non coperti, passo successivo raccomandato.
- [`docs/INFINITY_ODBC.md`](docs/INFINITY_ODBC.md): integrazione con il database Infinity via ODBC (mappatura delle tabelle, limiti riscontrati, passaggio a `infinity01`).
- [`CLAUDE.md`](CLAUDE.md): regole di sviluppo e priorità.
