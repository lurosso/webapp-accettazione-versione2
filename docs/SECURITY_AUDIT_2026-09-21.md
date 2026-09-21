# Audit di sicurezza e blindatura — 21 settembre 2026

Audit del codice prima dell'integrazione con Spoki, su quattro aree: portale cliente (esposizione
pubblica), upload di foto e video, API/autorizzazioni/sessioni, integrità dei dati e header HTTP.

**Metodo.** Quattro revisori indipendenti in sola lettura, uno per area, con l'obbligo di citare
file e riga di ogni segnalazione e di dichiarare anche ciò che era già protetto. Le 48 segnalazioni
grezze sono state riverificate una per una sul codice prima di scrivere una patch; quelle non
confermate o non applicabili sono elencate in fondo con la motivazione. Tutto ciò che è stato
chiuso ha un test in `tests/security/` (13 file, 58 casi) e la suite completa passa
(513 test, `npm run typecheck`, `npm run lint`).

Legenda: **APERTO → CHIUSO** = trovato e corretto in questo intervento · **GIÀ CHIUSO** = verificato
presente e corretto prima dell'audit · **DECISIONE** = mitigato con un interruttore, ma la scelta
finale spetta al committente.

---

## 1. Portale cliente (esposizione pubblica)

### Prevedibilità di URL e identificativi — GIÀ CHIUSO

- Gli id delle pratiche sono UUID v4 (`UuidIdGenerator`, `crypto.randomUUID`) e **nessuna rotta
  pubblica accetta un id**: il cliente arriva alla pratica per targa (QR) o per **token** del link
  WhatsApp. Il token è un HMAC-SHA256 dell'id con confronto a tempo costante.
- **Rafforzato**: il token passa da 48 a **64 bit** (16 caratteri esadecimali) e la sua chiave è
  ora **derivata** dal segreto di sessione (`derivePortalTokenKey`), così cookie degli operatori e
  link dei clienti non condividono la stessa chiave (`portal-token.ts`, `container.ts`).

### Rate limiting e brute force — APERTO → CHIUSO (alto)

- **Trovato**: `clientIpFrom` prendeva il **primo** valore di `X-Forwarded-For`, cioè quello che il
  client scrive da sé. Ruotando l'intestazione a ogni richiesta, il tetto per indirizzo (240/min) si
  azzerava e restava solo il tetto per targa, che non limita targhe *diverse*: enumerazione di targhe
  senza freno, e stessa tecnica sul login (`login-ip`) e sul tetto di connessioni SSE.
- **Chiuso**: nuova variabile `TRUST_PROXY_HEADERS` (default `false`). Senza proxy fidato le
  intestazioni non valgono nulla e il contatore per indirizzo **non si applica** (meglio nessun
  contatore che uno che il client azzera a piacere); dietro proxy fidato vale `X-Real-IP` oppure
  l'**ultimo** valore di `X-Forwarded-For`, quello messo dal proxy. In più, su status, arrival,
  late-notice, board, display e health c'è ora un **tetto globale a chiave costante**, che non si
  aggira ruotando nulla (`lib/http/rate-limit.ts`, `config/constants.ts`).
- **Trovato**: le chiavi del limitatore non venivano mai eliminate e il `GET /public/status` non
  limitava la lunghezza di `targa`/`t`: centomila token casuali da 2 KB restavano in memoria fino al
  riavvio. **Chiuso**: parametri con lunghezza massima (400 oltre), tetto di 20 000 chiavi vive con
  pulizia delle finestre scadute e scarto delle più vecchie.
- Bucket condiviso: prima, senza proxy, tutti i clienti cadevano in `ip:sconosciuto` e un solo
  telefono poteva saturare il portale per tutti (240/min). Ora senza indirizzo affidabile il
  contatore per indirizzo non esiste e restano quello per targa (che il singolo non può saturare
  per gli altri) e quello globale (3000/min).

### Esposizione dei dati — GIÀ CHIUSO, con due ritocchi

- I read model pubblici sono costruiti campo per campo: **nessun nome, telefono, email, nota,
  commessa, id del database** esce da `/public/status`, `/public/board` (solo codici),
  `/public/display` (codice e targa dello sportello), né dal flusso SSE pubblico (solo il tipo
  dell'evento). Verificato sul codice, campo per campo.
- **Trovato e chiuso**: un `VERSION_CONFLICT` nel repository restituiva **la pratica intera**
  (cliente, telefono, note) dentro `details`, e le rotte pubbliche la serializzavano così com'era.
  Ora le rotte pubbliche rispondono con `publicErrorResponse`, che non ha mai `details`; il 404
  della targa non riflette più l'input; il 404 del display non elenca più gli sportelli validi.
- **Trovato e chiuso**: `/api/v1/health` era pubblico, senza tetto di frequenza (ogni chiamata
  apriva una connessione ODBC verso Infinity) e rivelava DSN, versione del database, utente e testo
  degli errori di configurazione. Ora: tetto 120/min, e agli anonimi solo stato aggregato e stato per
  porta; il dettaglio resta a chi ha sessione o segreto del cron.

### Scritture pubbliche con la sola targa — DECISIONE

- «Sono qui» e «In ritardo» si possono inviare conoscendo la sola targa (dal QR): chi legge una
  targa sul piazzale può far comparire un cliente «in fila» o mascherarne il ritardo per due ore.
  È il flusso QR voluto dal prodotto finché i link WhatsApp non sono in uso, quindi **non è stato
  spento**: è stato aggiunto l'interruttore `PORTAL_WRITES_REQUIRE_TOKEN` (default `false`). Acceso,
  le scritture dal portale valgono solo con il link personale e un token sbagliato non ripiega più
  sulla targa; il canale WhatsApp (identificato dal numero) non cambia. Da accendere quando i link
  con token saranno la via principale.

### Display senza token — DECISIONE

- `DISPLAY_TOKEN_REQUIRED` è `false` per default: `/api/v1/public/display?campata=A` risponde a
  chiunque raggiunga il server con codice e targa in lavorazione. I quattro monitor non sono ancora
  configurati con `?token=`, quindi cambiare il default oggi li spegnerebbe. Aggiunto un **avviso
  all'avvio** quando il flag è spento con dati reali; la chiusura definitiva è configurare i monitor
  con il token e impostare `DISPLAY_TOKEN_REQUIRED=true`.

---

## 2. Upload di foto e video

### Validazione del tipo lato server — APERTO → CHIUSO (medio)

- **Trovato**: il tipo era quello dichiarato dal client (`file.type`), e con tipo vuoto si assumeva
  `image/jpeg`. Un eseguibile, un HTML o un SVG rinominati `.jpg` finivano su disco come immagini.
- **Chiuso**: il tipo lo decidono i **magic byte** (`lib/media/mime-sniff.ts`): JPEG, PNG, WebP,
  HEIC/HEIF (box `ftyp` e brand), MP4/QuickTime/M4V/3GPP (brand ISO BMFF, anche fra i compatibili),
  WebM (EBML con DocType `webm`). Tutto il resto è rifiutato con `Formato non supportato`, il tipo
  dichiarato resta solo nel messaggio e in un avviso nel log. Il tipo salvato (e l'estensione della
  chiave) è quello **reale**: un PNG dichiarato JPEG resta PNG. Test: `.exe`, `.svg`, `.html`,
  `.pdf`, Matroska, firme messe in mezzo al file.

### Limiti di dimensione — APERTO → CHIUSO (alto)

- **Trovato**: il limite (8 MB foto, 80 MB video) veniva applicato **dopo** `request.formData()`,
  che materializza tutto il corpo in memoria: un multipart da qualche gigabyte avrebbe abbattuto
  l'unico processo Node dell'officina prima di qualunque controllo.
- **Chiuso**: `Content-Length` **obbligatorio** (411 se manca) e verificato **prima** di leggere il
  corpo: oltre 80 MB + 512 KB di contorno multipart la risposta è 413 senza toccare il corpo. Restano
  i limiti per tipo nel servizio.
- **Nuovo**: tetti per pratica — 40 media, 5 video, 400 MB (`FASCICOLO_PIENO`) — perché media e
  database stanno sulla stessa unità e un disco pieno ferma anche SQLite. Campo `nota` limitato a
  500 caratteri, `categoria` dall'elenco.

### Nomi file e path traversal — GIÀ CHIUSO, con ritocchi

- Il nome del file del client **non viene mai usato**: la chiave è `<giornata>/<codice>/<prefisso>-<uuid>.<ext>`
  generata dal server; lo storage su disco valida ogni segmento (`KEY_SEGMENT`, niente `..`, `\`,
  assoluti) e ancora il percorso risolto alla cartella base. Verificato.
- **Ritocchi**: `GET /api/v1/media/[key]` faceva una seconda `decodeURIComponent` senza `try`
  (una sequenza malformata → 500) e non validava la forma della chiave prima dello storage: ora la
  chiave passa la stessa regex dello storage, la decodifica è protetta e la risposta è 400/404.
  I file escono con `Content-Disposition: inline; filename=…`, `X-Content-Type-Options: nosniff`,
  `Cross-Origin-Resource-Policy: same-origin` e una **CSP in sandbox** (`default-src 'none'; sandbox`):
  anche un contenuto interpretabile come documento non potrebbe eseguire nulla sull'origine dell'app.
  Tabella MIME↔estensione **unica** (`lib/media/mime-types.ts`): prima `.mov`/`.webm`/`.3gp` venivano
  riletti come `application/octet-stream`.

### Chi può caricare, e su cosa — APERTO → CHIUSO (medio)

- **Trovato**: le rotte dei media (elenco, upload, eliminazione, lettura del file) controllavano
  solo la sessione, non il ruolo: un account **KIOSK** (dispositivo in sala d'attesa) o del BDC
  poteva caricare file su qualunque pratica, eliminare il video di prova di una pratica in carico e
  leggere le foto dei veicoli. E `addMedia` non guardava lo **stato** della pratica: si potevano
  aggiungere immagini a un fascicolo già chiuso e già usato per rispondere a una contestazione.
- **Chiuso**: `canAccess('check-in')` su upload ed eliminazione, `canAccess('accettazione')` su
  elenco e file; media acquisibili **solo con la pratica in carico** (`MEDIA_SOLO_IN_CARICO`),
  simmetrico alla regola già presente per l'eliminazione.

---

## 3. API, autorizzazioni e sessioni

### Protezione inclusiva degli endpoint — APERTO → CHIUSO

Tabella completa delle 42 rotte compilata dal revisore; le eccezioni rispetto alle rotte sorelle
erano:

| Rotta | Prima | Ora |
| --- | --- | --- |
| `POST /appointments/[id]/check-in` | solo sessione | `canAccess('check-in')` |
| `GET/POST /appointments/[id]/media` | solo sessione | `accettazione` / `check-in` |
| `DELETE /appointments/[id]/media/[mediaId]` | solo sessione | `check-in` |
| `GET /media/[key]` | solo sessione | `accettazione` |
| `POST /sync` | lista nera (solo ADVISOR limitato) | lista bianca: manager sempre, ADVISOR come «Riprova», altri 403 |
| `GET /events/stream` | ogni ruolo | KIOSK escluso |
| `POST /system/cron/*` | segreto o ADMIN, senza tetto sui tentativi | `authorizeCronRequest`: segreto o ADMIN, 10 tentativi falliti/min |

- **KIOSK deny-by-default**: un account KIOSK è un dispositivo, non una persona. `readApiSession`
  ora lo rifiuta su tutte le API tranne login, logout, `me` e cambio password (`allowKiosk`).
- **Autorizzazione orizzontale**: un accettatore poteva **completare** la pratica in carico a un
  collega di un altro sportello (200, CRM avvisato, display liberato). Ora `complete` accetta solo
  chi ha la pratica in carico, un responsabile o l'amministratore (il ruolo viaggia in
  `ActionContext.role`); le automazioni di fine giornata restano libere. Prendere in carico una
  pratica di un altro sportello resta possibile: è una funzione voluta, con conferma in UI.
- **Accesso veloce (quick-login) — alto, DECISIONE**: con `next dev` su Prisma e Infinity reali,
  `DEV_QUICK_LOGIN` era acceso per default: chiunque sulla LAN poteva entrare da amministratore senza
  credenziali. Ora il default è acceso **solo quando tutto è mock**; con dati reali va chiesto
  esplicitamente e all'avvio compare un avviso a chiare lettere. In `.env.local` è **ancora
  `true`** (serve ai test sull'iPad): da spegnere appena finiti.
- **Mass assignment — GIÀ CHIUSO**: gli schemi Zod scartano i campi sconosciuti, i servizi
  ricostruiscono le entità campo per campo, il ruolo è un enum chiuso e solo ADMIN raggiunge le rotte
  degli operatori; un amministratore non può degradare o disattivare sé stesso né l'ultimo ADMIN.
  Verificato fino al repository.

### Sessioni — GIÀ CHIUSO, con due rafforzamenti

- Cookie `HttpOnly`, `SameSite=Lax`, `Secure` in produzione, senza `domain`; JWT HS256 con
  algoritmo bloccato e issuer verificato; segreto ≥ 32 caratteri obbligatorio appena un provider è
  reale, valore di sviluppo rifiutato fuori dal tutto-mock (fail-fast); ogni Route Handler
  riverifica operatore attivo, ruolo dal repository e occupazione dello sportello; password scrypt;
  quick-login sempre spento con `NODE_ENV=production`.
- **Revoca implicita** (nuovo): il token era valido fino alla scadenza anche dopo un cambio
  password, e tornava valido dopo un logout se l'operatore rientrava sullo stesso sportello. Ora la
  rivendicazione del posto porta l'istante di emissione: **una sola sessione valida per operatore**,
  login, cambio password e logout invalidano i token precedenti, senza lista di revoca.
- **Oracolo temporale sul login** (nuovo): con utente inesistente scrypt non veniva eseguito e il
  tempo di risposta rivelava quali nomi utente esistono. Ora si verifica comunque contro un hash
  fittizio: stesso costo, stesso messaggio.
- **CSRF — difesa in profondità** (nuovo): oltre a `SameSite=Lax`, il proxy rifiuta con 403 ogni
  richiesta che cambia stato (`POST/PATCH/DELETE`) su `/api/v1/*` dichiarata cross-site dal browser
  (`Sec-Fetch-Site`) o con `Origin` diversa dall'host che ci ha ricevuto (anche dietro reverse proxy,
  via `X-Forwarded-Host`); webhook esclusi (server-to-server). Test al livello del proxy.
- **Open redirect** (nuovo): `safeInternalPath` accettava `/\evil.example`, che per il parser degli
  URL è `//evil.example`: dopo il login l'operatore sarebbe finito su un altro sito. Ora si rifiuta
  `\` e si verifica l'origine con il parser.

---

## 4. Integrità dei dati e header HTTP

### Injection — GIÀ CHIUSO

- **SQL**: nessun `$queryRaw`/`$executeRaw` nei repository Prisma, filtri con l'API tipizzata; le
  query ODBC verso Infinity interpolano solo lo schema (validato da regex) e alias fissi, tutti i
  valori esterni sono parametri `?`. Verificato riga per riga dal revisore.
- **XSS**: React esegue l'escape; l'unico `dangerouslySetInnerHTML` è una costante (lo script della
  lente di densità); nessun `href`/`src` costruito da dati; i messaggi del server non finiscono nel
  DOM del portale (la UI mappa gli errori su testi fissi). Il flusso SSE serializza con
  `JSON.stringify`; i log serializzano il contesto in JSON (niente log injection).
- **CSV — APERTO → CHIUSO**: il report giornaliero non neutralizzava le formule. Un nome cliente
  `=HYPERLINK(...)` o `=cmd|' /C calc'!A0` (dal DMS o digitato) diventava una formula in Excel.
  Ora `csvCell` antepone un apostrofo a `=`, `@`, tabulazione, ritorno a capo e a `+`/`-` quando il
  resto non è un numero o un telefono (`+39 …` resta leggibile).

### Header di sicurezza — APERTO → CHIUSO

- **Prima**: `X-Content-Type-Options`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`,
  `Permissions-Policy` (camera solo alla stessa origine). Nessuna CSP, nessun HSTS, nessun COOP.
  CORS già stretto: nessun `Access-Control-Allow-Origin`, vale la same-origin policy del browser.
- **Ora**: **Content-Security-Policy con nonce per richiesta**, costruita dal proxy su tutte le
  pagine e le API (`lib/http/security-headers.ts`): `default-src 'self'`,
  `script-src 'self' 'nonce-…' 'strict-dynamic'`, `object-src 'none'`, `base-uri 'self'`,
  `form-action 'self'`, `frame-ancestors 'self'`, `img-src 'self' blob: data:`,
  `media-src 'self' blob:` (anteprime di foto e video al check-in), `font-src 'self' data:`,
  `connect-src 'self'`, `manifest-src 'self'`; in sviluppo soltanto `'unsafe-eval'` (React
  ricostruisce gli stack) e `ws:` (HMR). Next mette il nonce sui propri script, il layout lo mette
  sull'unico script inline nostro. `style-src 'self' 'unsafe-inline'`: React scrive gli stili in
  attributo e Tailwind li serve da file; un'iniezione di CSS senza script è un danno estetico, mentre
  bloccare gli attributi `style` sui tablet meno recenti sarebbe un danno operativo — si stringe con
  `style-src-attr` quando il parco dispositivi lo permette. Niente `upgrade-insecure-requests`: in
  officina la LAN è in HTTP. In più `Cross-Origin-Opener-Policy: same-origin` e, **solo in
  produzione**, `Strict-Transport-Security` (un anno, sottodomini).
- Il correlation id in ingresso è accettato solo se in forma (`^[A-Za-z0-9._-]{8,64}$`): un
  valore con a-capo faceva lanciare il costruttore di `Headers` (500).
- Le risposte di errore `INTERNAL` non portano più `details` (percorsi assoluti del disco, messaggi
  del file system).

---

## Cosa NON è stato cambiato, e perché

- **Ricerca per sola targa** nel portale: espone stato, codice, orari e nome dell'accettatore a chi
  conosce la targa. È il flusso QR voluto dal prodotto; il profilo dati è già senza informazioni
  personali del cliente. Un profilo ridotto per chi arriva senza token è possibile, ma cambierebbe
  ciò che la pagina mostra oggi: da decidere con il committente.
- **Webhook Spoki**: segreto statico condiviso, replay possibile con corpo modificato. Dipende da
  ciò che Spoki offre (firma HMAC con timestamp): da verificare quando si integra.
- **Media serviti per chiave e non per id**: l'URL espone il layout delle cartelle
  (`giornata/codice/file`), ma la chiave contiene un UUID e la rotta è autenticata e con ruolo; il
  passaggio all'id del `MediaAsset` è un refactoring da pianificare, non un buco.
- **Replay del flusso SSE pubblico via `?since=`**: trasmette solo tipo evento e istante; nessun
  dato personale. Rimandato.
- **Fascicolo legato allo sportello/operatore che carica**: l'upload richiede ruolo e pratica in
  carico; vincolare anche all'operatore che ha la pratica bloccherebbe l'amministratore che aiuta.

## Decisioni per il committente (interruttori pronti)

| Variabile | Oggi | Consigliato | Quando |
| --- | --- | --- | --- |
| `TRUST_PROXY_HEADERS` | `false` | `true` | appena l'app sta dietro Nginx/Caddy/IIS che sovrascrive `X-Forwarded-For` |
| `DISPLAY_TOKEN_REQUIRED` | `false` | `true` | dopo aver configurato i quattro monitor con `?token=` |
| `PORTAL_WRITES_REQUIRE_TOKEN` | `false` | `true` | quando i link WhatsApp con token saranno la via principale |
| `DEV_QUICK_LOGIN` | `true` in `.env.local` | `false` | appena finiti i test sul dispositivo; in produzione è spento comunque |
| `CRON_SECRET` | assente | stringa casuale ≥ 32 caratteri | se si userà un cron esterno |

## Test aggiunti (`tests/security/`)

`mime-sniff` (riconoscimento e travestimenti), `upload-service` (exe come jpg, SVG/HTML, tipo
reale, check-in aperto, tetti), `api-authz` (401, redirect, cookie manomesso, CSRF, CSP con nonce,
webhook, correlation id, HSTS), `session-revocation` (login/cambio password/logout), `portal-writes-token`,
`rate-limit-trust` (XFF ruotato, proxy fidato, tetto globale, chiavi vive), `csv-injection`,
`security-headers`, `same-origin`. I test esistenti sono passati a byte veri
(`tests/helpers/media-bytes.ts`) e a un helper che carica media come se il check-in fosse aperto
(`tests/helpers/media-fixtures.ts`).
