# Ospitare l'accettazione su SRV-AI

Cosa serve per far girare questo programma sul **server AI di Autoclub** (SRV-AI), secondo il
documento _«Server AI Autoclub – stato lavori e direzione del progetto»_ del 26/09/2026 (in questa
cartella). Sezione 2: le richieste da fare a chi gestisce il server. Sezione 3: quello che
prepariamo noi nel repository.

Escluso di proposito: tutta la parte del **nuovo portale myAutoclub** (login con Entra ID, permessi
dai gruppi AD, menu per moduli, sotto-percorso tipo `/preventivi`). L'accettazione ha il suo login,
i suoi ruoli e le postazioni degli sportelli, e oggi non è un modulo del portale. Se lo diventerà, si
adatterà allora.

## 1. Il programma, visto dal server

| Cosa                  | Com'è                                                                                                                                                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tecnologia            | Next.js 16 su Node.js (≥ 22), build `standalone`                                                                                                                                                                                                      |
| Processo              | **Uno solo**, sempre acceso: tiene in memoria parte dello stato e gira i lavori della giornata (sync da Infinity alle 06:00, promemoria alle 18:00 e alle 07:30, riprove dei messaggi, lettura dei tocchi da Spoki ogni 20 s). Mai due copie insieme. |
| Porta                 | 3000 (HTTP, dietro Caddy)                                                                                                                                                                                                                             |
| Dati propri           | database SQLite (un file, oggi < 1 MB, a regime qualche centinaio di MB) e cartella delle foto e dei video delle ispezioni                                                                                                                            |
| Infinity              | **solo lettura**, via ODBC (SQL Anywhere): l'agenda del giorno alle 06:00 e quando l'accettatore aggiorna. Poche query brevi: non serve la copia su PostgreSQL                                                                                        |
| Verso Internet        | solo Spoki (WhatsApp), `https://api.spoki.com`. Gli SMS oggi sono simulati                                                                                                                                                                            |
| Chi lo usa            | accettatori da PC e iPad/tablet sul piazzale, 4 monitor delle campate e il tabellone della sala d'attesa, **e i clienti dal loro telefono** (QR in officina e link su WhatsApp)                                                                       |
| Controllo dello stato | `GET /api/v1/health`                                                                                                                                                                                                                                  |

## 2. Da chiedere a chi gestisce SRV-AI

### A. Stack, spazio e backup

1. Uno **stack «accettazione»** in Portainer, con **un solo container** (mai repliche), riavvio
   automatico e fuso `Europe/Rome`. Risorse indicative: 2 vCPU e 2 GB di RAM.
2. Un **volume persistente su `/srv`** (per esempio `/srv/stacks/accettazione/data`) per il
   database e per le foto e i video. **Stima dello spazio: 50–150 GB a regime.** Le foto partono
   dall'iPad così come sono (circa 3 MB l'una, sei per ispezione), i video fino a 80 MB, e si
   conservano 90 giorni. Con 30–40 ispezioni al giorno fanno circa 1 GB al giorno. La stima va
   rifatta dopo le prime settimane.
3. **Backup del database coerente**: il backup Veeam della VM copia il file mentre il programma
   scrive. Serve, come per Gitea, una copia notturna del database fatta con il programma fermo o
   con il comando di backup di SQLite (la prepariamo noi, sezione 3), inclusa nel backup. Foto e
   video bastano nel backup della VM.
4. I **segreti come variabili d'ambiente in Portainer**, mai nel repository: `SESSION_SECRET`,
   `CRON_SECRET`, `INFINITY_ODBC_UID` e `INFINITY_ODBC_PWD`, `SPOKI_API_KEY` e i segreti di Spoki
   (`SPOKI_SECRET_REMINDER_SAME_DAY`, `SPOKI_WEBHOOK_SECRET`). L'elenco completo, con i valori di
   esempio, è in `.env.example`.

### B. Rete interna: accettatori, tablet e monitor

1. Un **nome interno** per il programma (per esempio `accettazione.movingcenter.local`) con Caddy
   che inoltra al container sulla porta 3000. Caddy deve:
   - passare l'indirizzo del client (`X-Forwarded-For`): l'app lo usa per i limiti anti-abuso, con
     `TRUST_PROXY_HEADERS=true`;
   - accettare caricamenti fino a **80 MB** (i video dell'ispezione);
   - non bufferizzare le risposte in streaming (`/api/v1/events/stream`, `/api/v1/public/events/stream`):
     coda, monitor e tabellone si aggiornano così.
2. Un **certificato attendibile anche sugli iPad e sui tablet**. In produzione il login funziona
   solo in HTTPS (cookie di sessione `Secure`), e un avviso del certificato su ogni tablet non è
   gestibile in officina. La CA interna distribuita via GPO arriva ai PC Windows, non agli iPad: per
   quelli serve un profilo (MDM) oppure il certificato Let's Encrypt su un nome `autoclubgroup.it`,
   come previsto nel documento.
3. Che la **rete Wi-Fi di tablet e iPad** e quella dei **monitor delle campate** raggiungano quel
   nome.

### C. Infinity

1. **Utente dedicato in sola lettura**, come da documento, sulle tabelle che il programma legge:
   `tdo_pre`, `tipi_doc`, `o_operai`, `off_veicoli`, `off_invii_fal`, `off_marche`, la vista
   `clienti`, `off_modelli`, `mdm_pre_inc`, `vs_off_inc_tipoinc`, `telefono`, `off_stati_doc`
   (e, facoltative, `contatti`, `off_tipi_intervento`, `default_generali`). Più
   `GRANT EXECUTE ON dba.sp_off_docs_planning`: è la stessa procedura del planning di Infinity. Senza
   funziona lo stesso, ma legge le tabelle (dettagli in `docs/INFINITY_ODBC.md` §6).
2. **FortiGate**: da SRV-AI verso il server Infinity (oggi `10.10.193.18`) porta **2638**
   (SyInfinity01, Autoclub) e **2644** (SyInfinity_Test).
3. **Accesso a SyInfinity_Test** per il collaudo: il documento vuole sviluppo e collaudo sul
   database di test e la produzione solo al rilascio. Oggi il programma legge SyInfinity01 dal PC
   dello sviluppatore.
4. **Il client SQL Anywhere 17 per Linux** (driver ODBC), da mettere nell'immagine Docker: da dove
   lo prendiamo (download SAP o pacchetto già usato dal reparto) e se ci sono vincoli di licenza.

### D. Uscita verso Internet (FortiGate)

1. Il **container**: `api.spoki.com` sulla porta 443 (invio dei WhatsApp, lettura dei tocchi sui
   pulsanti).
2. Il **runner di Gitea Actions**, per costruire l'immagine: registro npm (`registry.npmjs.org`),
   Docker Hub (immagine base di Node) e il download del client SQL Anywhere, se non lo fornite voi.

### E. Accesso da fuori, per i clienti (il punto più importante)

Le pagine del cliente si aprono **dal telefono del cliente**, spesso in 4G: il QR in officina e il
link personale che arriva su WhatsApp. Con l'accesso «solo dalla rete aziendale» del documento non
funzionano. Serve pubblicare su Internet **solo questi percorsi**, su un nome pubblico (per esempio
`accettazione.autoclubgroup.it`) con certificato pubblico, tramite FortiGate sulla porta 443 e il
reverse proxy in DMZ:

| Percorso                                                                        | Chi lo usa                                                     |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `/qr`, `/cliente`, `/cliente/stato`, `/portal`, `/portal/<codice>`              | il cliente (pagine)                                            |
| `/api/v1/public/status`, `/api/v1/public/arrival`, `/api/v1/public/late-notice` | il cliente (le stesse pagine, «Sono qui», «Sono in ritardo»)   |
| `/_next/static/…`, `/icon-192.png`, `/icon-512.png`, `/apple-touch-icon.png`    | il browser del cliente (file della pagina)                     |
| `/api/v1/webhooks/spoki` (solo POST)                                            | i server di Spoki (esiti dei WhatsApp e tocchi in tempo reale) |

Tutto il resto (area degli accettatori, amministrazione, monitor, API interne) resta **solo
interno**, come Gitea e Portainer. Le pagine pubbliche non mostrano dati personali (codice, targa,
posizione in fila) e hanno già i loro limiti anti-abuso. Con l'indirizzo pubblico, `PUBLIC_BASE_URL`
diventa quello: i link su WhatsApp puntano lì, e Spoki può avvisare l'app a ogni tocco, senza la
lettura ogni 20 secondi.

### F. Monitoraggio

Zabbix può interrogare `/api/v1/health` (risponde 200 finché il processo è vivo; con
`?probe=dependencies` risponde 503 quando Infinity o gli altri servizi esterni sono giù). I log
escono su stdout.

## 3. Da preparare noi nel repository

Le regole di sviluppo del documento, punto per punto:

| Regola                                         | Stato                                                                                                                                                                                                                            |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Dockerfile e `compose.yaml`                 | **da fare**: immagine multi-stage (`standalone`, utente non root, unixODBC + driver SQL Anywhere 17, `better-sqlite3`), `compose.yaml` con un servizio, il volume e il controllo di salute; all'avvio le migrazioni del database |
| 2. Nessuna gestione utenti propria             | escluso per ora (parte del portale myAutoclub): l'accettazione ha il suo login e i suoi ruoli                                                                                                                                    |
| 3. Configurazione da variabili d'ambiente      | già così (`.env.example`); i segreti andranno in Portainer                                                                                                                                                                       |
| 4. Rilascio con tag di versione su Gitea       | **da fare**: repository su Gitea (organizzazione «ai») e un workflow Gitea Actions che, sul tag, lancia typecheck, lint, test e costruisce l'immagine nel registry                                                               |
| 5. Dati di test, nessuna scrittura su Infinity | nessuna scrittura: già così. Dati di test: serve l'accesso a SyInfinity_Test (2.C)                                                                                                                                               |
| 6. Log su stdout/stderr                        | già così                                                                                                                                                                                                                         |
| 7. Sotto-percorso dietro reverse proxy         | escluso per ora (parte del portale): l'app sta su un nome suo                                                                                                                                                                    |
| 8. README con variabili e porta                | **da completare**: una sezione «Rilascio su SRV-AI» con variabili richieste, porta 3000 e volume                                                                                                                                 |

In più, per il server: la copia notturna coerente del database SQLite (2.A.3) e, in produzione,
`DEV_QUICK_LOGIN=false` e `DISPLAY_TOKEN_REQUIRED=true` (i monitor con il loro token).
