# Integrazione Infinity (Zucchetti) via ODBC — SQL Anywhere 12

Stato al 2026-09-15: adapter reale in **sola lettura** verificato sul database di prova
`infinity02`; pronto per `infinity01` cambiando una variabile d'ambiente. La query nativa del
planning di Infinity (Ctrl+Shift+F9) è stata analizzata e riprodotta: vedi §5 e §6.

## 1. Cosa fa

`InfinityServiceOdbc` (`src/infrastructure/adapters/infinity/`) implementa la porta
`IInfinityService` leggendo il **Planning Appuntamenti Clienti** direttamente dal database del
gestionale tramite il driver ODBC "SQL Anywhere 12" già installato sul server (DSN di sistema a
64 bit). Restituisce la stessa forma wire (`InfinityAgendaDto`) prodotta da `InfinityServiceMock`:
mapper, sync delle 06:00, resilienza (`InfinityServiceResilient`) e dashboard non cambiano.

Solo istruzioni `SELECT`. L'adapter non scrive mai su Infinity.

Due sorgenti equivalenti per la testata del planning, stesse colonne in uscita:

- **procedura** `sp_off_docs_planning` — la stessa procedura che alimenta il planning di Infinity.
  Restituisce prenotazioni (genere `Z`) e commesse in consegna (genere `L`) con i flag `deleted`,
  `closed`, `pren_closed`, `confermato`. Richiede `GRANT EXECUTE` all'utenza del DSN.
- **tabelle** `tdo_pre` e collegate — funziona con la sola `SELECT`. Le prenotazioni annullate si
  riconoscono dallo stato documento (`off_stati_doc`: "Annullata").

`INFINITY_PLANNING_SOURCE=auto` (predefinito) prova la procedura e, se non è concessa, ripiega
sulle tabelle avvisando una volta nel log. Gli arricchimenti (cliente, telefono, lavorazioni,
tempi, modello) sono gli stessi per entrambe.

## 2. Configurazione (`.env.local`)

| Variabile                                                             | Default           | Significato                                                                                                                    |
| --------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `INFINITY_PROVIDER`                                                   | `mock`            | `real` attiva l'adapter ODBC (richiede `SESSION_SECRET` e un seed senza credenziali demo).                                     |
| `INFINITY_ODBC_DSN`                                                   | —                 | Nome del DSN ODBC di sistema. **Prova: `Infinity02`. Produzione: `Infinity01`.** Obbligatorio con `real`.                      |
| `INFINITY_DB_TYPE`                                                    | `sql_anywhere_12` | Motore; oggi l'unico supportato.                                                                                               |
| `INFINITY_ODBC_UID` / `INFINITY_ODBC_PWD`                             | vuoti             | Solo se il DSN non memorizza le credenziali. Mai nel repository.                                                               |
| `INFINITY_ODBC_EXTRA`                                                 | vuoto             | Attributi ODBC appesi alla stringa di connessione, prevalgono sul DSN (es. `Host=10.10.193.18:2638` per correggere una porta). |
| `INFINITY_DB_SCHEMA`                                                  | `DBA`             | Proprietario delle tabelle applicative.                                                                                        |
| `INFINITY_BOOKING_DOC_TYPES`                                          | `PR01`            | Tipi documento (`tipi_doc.codice`) che valgono come prenotazione, separati da virgola.                                         |
| `INFINITY_PLANNING_SOURCE`                                            | `auto`            | `auto` \| `procedure` \| `tables` (vedi §1).                                                                                   |
| `INFINITY_SEDE`                                                       | vuoto             | Codice sede per la procedura (`tipi_doc.sede_cont`, es. `01` = Bari). Vuoto = ricavato dai tipi documento.                     |
| `INFINITY_ODBC_LOGIN_TIMEOUT_SEC` / `INFINITY_ODBC_QUERY_TIMEOUT_SEC` | `10` / `60`       | Tempi massimi.                                                                                                                 |

Il DSN `Infinity02` rilevato sul PC di sviluppo: driver `SQL Anywhere 12`
(`C:\Program Files\SQL Anywhere 12\Bin64\dbodbc12.dll`), host `10.10.193.18:2639`, server
`infinity02`, autenticazione non integrata, nessuna cifratura, utente e password memorizzati nel
DSN. La stringa di connessione passata dall'applicazione è quindi `DSN=Infinity02;CharSet=UTF-8`
(il `CharSet` lo aggiunge sempre l'adapter: il database è in windows-1252, §6bis).

Il modulo nativo è `odbc@2.5.0` (binario precompilato per Node 24 / Windows x64), caricato con
`import()` solo alla prima query, così in modalità mock non viene nemmeno toccato;
`next.config.ts` lo dichiara in `serverExternalPackages`.

## 3. Verifica a terminale

```bash
npm run infinity:check
```

La suite `tests/integration/infinity-odbc.test.ts` gira solo se `INFINITY_ODBC_DSN` è impostata
(altrimenti è saltata: la CI resta verde senza database). Stampa, nell'ordine: la connessione
(motore, database, utente), la **verifica degli accessi** oggetto per oggetto con i `GRANT` da
richiedere, il planning della giornata `INFINITY_ODBC_DATE` (default: oggi) e il primo
appuntamento nella forma DTO. I telefoni sono mascherati. In PowerShell:

```powershell
$env:INFINITY_ODBC_DSN='Infinity02'; $env:INFINITY_ODBC_DATE='2023-12-28'; npm run infinity:check
```

Esito del 2026-09-15 su `infinity02` (copia di prova con dati fino a novembre 2024, giornata
2023-12-28, sorgente `tables` perché la procedura non è concessa):

| Voce                   | Valore                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------- |
| Connessione            | UP in 408 ms, SQL Anywhere 12.0.1.4436, db `infinity02`, utente in solo gruppo PUBLIC |
| Prenotazioni `PR01`    | 18, lette in 6,5 s (testata più tre query di arricchimento)                           |
| Con nome cliente       | 18 (vista `clienti`)                                                                  |
| Con cellulare          | 17 (recapito notifiche dell'anagrafica)                                               |
| Con lavorazioni        | 18 (righe `mdm_pre_inc`, con ore stimate)                                             |
| Con targa              | 9 (solo dagli invii FAL, vedi §7)                                                     |
| Annullate riconosciute | 1 (stato documento "Annullata")                                                       |
| Modello                | descrizione da `off_modelli` (es. "500X 1.3 MJET")                                    |

## 4. Mappatura delle tabelle

Schema `DBA`, colonne reali come rilevate su `infinity02` (3 329 tabelle utente).

| Dato                    | Sorgente                                                                                                                                                                                                                               | Note                                                                                                                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prenotazione            | `sp_off_docs_planning` oppure `tdo_pre` (`id_documento`, `tipo_doc`, `num_doc`, `anno`, `data_doc`)                                                                                                                                    | `id_documento` → `externalId` `PRE-<id>`; una prenotazione già diventata commessa conserva l'id della prenotazione e porta `idCommessa`.                                                                    |
| Tipo documento e sede   | `tipi_doc` (`descrizione`, `sede_cont`)                                                                                                                                                                                                | `PR01` Bari sede `01` (attivo), `PR20` Massafra `02` (attivo), `PR30` Foggia e `PR40` Modugno (disattivi).                                                                                                  |
| Data e ora              | `data_prenotazione` (date), `ora_prenotazione` (time); per le commesse `doc_data_prevcons`/`doc_ora_prevcons`                                                                                                                          | Orario locale dell'officina → `scheduledAt` ISO con `buildLocalDateTime` (fuso `APP_TIMEZONE`).                                                                                                             |
| Cliente                 | vista `clienti` (`codice_cliente = id_cliente`): `ragione_sociale`, `cognome`, `nome`, `cons_privacy`                                                                                                                                  | Leggibile anche dove `anagrafica` non lo è. Cliente generico della sede (`default_generali.id_cliente_def`): il nome sta in `note_cliente`, come nella query nativa.                                        |
| Telefono                | `telefono` (`tipo 'C'`, `valido 1`, `usa_per_notifiche`) → `clienti.indirizzo_notifiche` (con `pref_invio_notifiche` diverso da `E`) → `clienti.telefono1..3` → `contatti.cellulare`                                                   | Su `infinity02` il 93 % dei clienti con prenotazione ha il cellulare in `indirizzo_notifiche`; la tabella `telefono` ne copre il 10 %.                                                                      |
| Referente               | `contatti` (`codice_contatto`): `ragione_sociale`, `cellulare`                                                                                                                                                                         | Chi accompagna il veicolo, quando indicato.                                                                                                                                                                 |
| Accettatore             | `accettatore_prenotazione` (matricola) → `o_operai.nome`                                                                                                                                                                               | Es. matricola `102` → nome dell’accettatore in `o_operai`.                                                                                                                                                  |
| Riconsegna prevista     | procedura: `doc_data_prevcons`, `doc_ora_prevcons` (dal documento: prenotazione, o commessa se già aperta; `data_prevcons`/`ora_prevcons` della procedura sono sempre vuoti); tabelle: `tdo_pre.data_prevcons`, `tdo_pre.ora_prevcons` | `expectedDeliveryDate`/`expectedDeliveryTime` nel DTO → `Appointment.expectedDelivery`. Il 2026-09-25 compilata su 24 prenotazioni su 24 di oggi e 33 su 39 del 28/09, da 0 a 6 giorni dopo l'appuntamento. |
| Targa, telaio, veicolo  | procedura: `targa`, `telaio`, `cod_marca`, `cod_modello`, `id_veicolo`; tabelle: `off_veicoli` via `tdo_pre.id_veicoliofficina`, in mancanza ultimo `off_invii_fal` del documento e il suo `id_veicolo`                                | Su `infinity02` `id_veicoliofficina` è sempre vuoto (§7).                                                                                                                                                   |
| Marca e modello         | `off_marche.descrizione`; `off_modelli.descrizione` (`cod_marca` + `cod_modello`)                                                                                                                                                      | `00` FIAT, `57` Jeep, `70` Lancia, `83` Alfa Romeo, `91` Citroen, `47` OPEL, `48/51` Peugeot → `brandCode` dell'app (`brandCodeFromDescription`).                                                           |
| Lavorazioni richieste   | `mdm_pre_inc` (`descr_inconveniente`, `tempo_stimato`), agganciata per `anno`, `id_cliente`, `tipo_doc`, `data_doc`, `numero_doc`                                                                                                      | Copre il 99,7 % delle prenotazioni 2023-2024. `serviceDescription` = righe unite con `·`; in mancanza tipi di incarico, poi `note_cliente`, poi `note_doc`.                                                 |
| Tempi per tipo incarico | vista `vs_off_inc_tipoinc` (`codice`, `descrizione`, `tempo_stimato`)                                                                                                                                                                  | `T` Tagliando, `G` Generico…; `tempoStimatoOre` = somma.                                                                                                                                                    |
| Tipo intervento         | `off_tipi_intervento`                                                                                                                                                                                                                  | `1` Prevendita, `2` Postvendita.                                                                                                                                                                            |
| Stato                   | procedura: `deleted`, `closed`, `pren_closed`, `confermato`; entrambe: `id_stato_doc` → `off_stati_doc.descrizione`                                                                                                                    | `0` Appuntamento, `1` Prenotazione, `2` Preventivo, `3` Chiusa in ODL, `4`/`18` Annullata, `10+` stati commessa. `annullata` → `cancelled: true` nel DTO.                                                   |
| Note                    | `note_doc`, `note_cliente`                                                                                                                                                                                                             | Testo libero.                                                                                                                                                                                               |
| Altri campi             | `flag_clienteinsala`, `ordine_lavoro`/`order_id`, `tipo_intervento`, `proprietario`, `data_prevcons`, `data_modifica`                                                                                                                  | Esposti in `InfinityPlanningRecord` per uso futuro.                                                                                                                                                         |

Consenso WhatsApp: `clienti.cons_privacy` è il consenso privacy generale, non quello WhatsApp:
il DTO porta `whatsappOptIn: null` (l'app lo tratta come consenso assente e ripiega su SMS o
contatto manuale); il valore è comunque esposto in `consensoPrivacy`.

## 5. La query nativa del planning e come è stata riprodotta

La query che Infinity esegue per il planning (vista con Ctrl+Shift+F9) legge da
`dba.sp_off_docs_planning(:ad_data, :as_codsede, :as_accettatore, :as_puntoVendita,
:ai_gruppoQualifica, :ai_aperte)` e arricchisce con `tipi_doc`, `off_tipi_intervento`, `clienti`,
`o_operai`, `contatti`, `mdm_pre_inc`/`mdm_cli_inc` (tempo stimato), `vs_off_inc_tipoinc` (tempi
per tipo incarico), `off_modelli`, `utenti` e alcune funzioni. Parametri della procedura (dal
catalogo): `ad_data` date, `as_sede` varchar(2), `as_accettatore` default `'T'` (tutti),
`as_puntovendita` default null, `ai_gruppoQualifica` default 0, `ai_aperte` default 0, più
`ad_dataA` e `ad_dataAnalisi` facoltativi. L'adapter la chiama come
`sp_off_docs_planning(?, ?, 'T', NULL, 0, 0)` con giornata e sede.

| Parte della query nativa                                                                                                      | Nell'adapter                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cliente_gen` / `ragione_sociale` (cliente generico → `note_cliente`)                                                         | Riprodotto (`id_cliente_generico` da `default_generali` per la sede).                                                                                                                                     |
| `tab.*` (data/ora, documento, targa, telaio, marca, modello, accettatore, note, flag, proprietario, contatto)                 | Riprodotto colonna per colonna; in modalità tabelle i flag `deleted`/`closed` sono sostituiti dallo stato documento.                                                                                      |
| `genere_doc` (`L` commessa / `Z` prenotazione) e `coalesce(id_commessa, id_documento)`                                        | Riprodotto; l'identificativo resta quello della prenotazione (`PRE-<id_documento>`), la commessa va in `idCommessa`. Le commesse senza prenotazione entrano solo con `INFINITY_INCLUDE_WORK_ORDERS=true`. |
| `o_operai.nome`, `contatto`, `descr_modello`                                                                                  | Riprodotti.                                                                                                                                                                                               |
| `tempo_stimato` (somma da `mdm_pre_inc`/`mdm_cli_inc`) e `tempi`/`tempi_marca` (liste da `vs_off_inc_tipoinc`)                | Riprodotti in forma strutturata (`lavorazioni`, `tempi`, `tempoStimatoOre`) con due query separate invece delle sottoquery per riga.                                                                      |
| `color` (`fn_getpermessoutente`, `utente_coll`, `vs_off_color_planning` → `fn_getRGB`, `vs_off_stato_inconvenienti_commesse`) | **Non riprodotto**: è il colore della riga nel client Infinity e dipende dall'utente collegato (tabella temporanea di sessione). L'app ha i propri stati.                                                 |
| `veicolo_cortesia` (`fn_off_doc_vei_cortesia`)                                                                                | **Non riprodotto** (fuori perimetro); la funzione è nell'elenco dei permessi facoltativi.                                                                                                                 |
| `utente` (creatore del documento da `utenti`)                                                                                 | Non riprodotto: non serve alla coda.                                                                                                                                                                      |
| `lavorazioni`, `ricambi`, `ragione_sociale_proprietario`, `estesa`                                                            | Nella query nativa sono `null`/costanti: nulla da riprodurre.                                                                                                                                             |

Le SQL complete sono in `infinity-planning-query.ts` (`planningProcedureSql`,
`planningTablesSql`, `linesSql`, `tempiSql`, `phonesSql`).

## 6. Permessi: cosa serve e quali GRANT chiedere

Su `infinity02` l'utenza del DSN appartiene solo al gruppo `PUBLIC`. Tutte le procedure e le
funzioni di Infinity sono concesse al gruppo **`utenti_infinity`** (4 139 oggetti, fra cui
`sp_off_docs_planning`, `fn_getpermessoutente`, `fn_off_doc_vei_cortesia`, `fn_getRGB`,
`fn_rimuovi_doppi_spazi`). Le tabelle e le viste usate dall'adapter sono invece **tutte leggibili
già oggi** (verificato con `checkAccess`, §3).

| Oggetto                                                                                          | Livello         | Esito su `infinity02`                                      | GRANT da chiedere                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------ | --------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tdo_pre`, `tipi_doc`, `o_operai`, `off_veicoli`, `off_invii_fal`, `off_marche`                  | obbligatorio    | OK                                                         | nessuno                                                                                                                                                                                               |
| vista `clienti`, `off_modelli`, `mdm_pre_inc`, `vs_off_inc_tipoinc`, `telefono`, `off_stati_doc` | consigliato     | OK                                                         | nessuno (senza `clienti` il planning si legge lo stesso, con i clienti come «Cliente <id>», §6bis)                                                                                                    |
| `contatti`, `off_tipi_intervento`, `default_generali`                                            | facoltativo     | OK                                                         | nessuno                                                                                                                                                                                               |
| `sp_off_docs_planning`                                                                           | **consigliato** | NEGATO                                                     | `GRANT EXECUTE ON dba.sp_off_docs_planning TO <utente_dsn>;`                                                                                                                                          |
| `fn_off_doc_vei_cortesia`                                                                        | facoltativo     | NEGATO                                                     | `GRANT EXECUTE ON dba.fn_off_doc_vei_cortesia TO <utente_dsn>;` (solo se un giorno servirà il veicolo di cortesia)                                                                                    |
| `anagrafica` (sotto la vista `clienti`)                                                          | consigliato     | NEGATO (`fn_rimuovi_doppi_spazi` in una colonna calcolata) | su `infinity02` non serve (la vista `clienti` si legge lo stesso); su `infinity01` la vista è negata finché mancano `GRANT EXECUTE ON dba.fn_get_cons_privacy` e `dba.fn_rimuovi_doppi_spazi` (§6bis) |
| `fn_getpermessoutente`, `fn_getRGB`, `vs_off_color_planning`, `utente_coll`                      | non usati       | NEGATO                                                     | nessuno: servono solo al colore della riga nel client Infinity                                                                                                                                        |

**Richiesta minima per `infinity01`**: il solo `GRANT EXECUTE ON dba.sp_off_docs_planning` alla
utenza del DSN. Con quello l'adapter usa la stessa procedura del planning di Infinity (flag di
cancellazione e chiusura nativi, commesse in consegna, eventuali filtri di sede/punto vendita del
gestionale). Senza, funziona comunque in modalità tabelle con le stesse informazioni essenziali e
la cancellazione ricavata dallo stato documento.

Alternativa più ampia, sconsigliata per il principio del minimo privilegio:
`GRANT MEMBERSHIP IN GROUP utenti_infinity TO <utente_dsn>;` (dà l'esecuzione di tutte le
procedure del gestionale, comprese quelle che scrivono).

L'elenco aggiornato lo stampa `npm run infinity:check` sul database che si sta per usare: la
procedura potrebbe avere grant diversi su `infinity01`.

## 6bis. Primo collegamento a `infinity01` (2026-09-16)

Sul PC esiste il DSN di sistema `Infinity01` (driver SQL Anywhere 12, utente `lrossi_db`,
credenziali memorizzate). Due cose emerse al primo tentativo:

1. **Porta sbagliata nel DSN.** Il DSN indica `Host=10.10.193.18:2639`, che è la porta di
   `infinity02`; il server `infinity01` ascolta sulla **2638** (verificato con `dbping`). Senza
   toccare la configurazione di sistema, l'adapter accetta `INFINITY_ODBC_EXTRA` (attributi ODBC
   appesi alla stringa di connessione, che prevalgono sul DSN): in `.env.local` è impostato
   `INFINITY_ODBC_EXTRA=Host=10.10.193.18:2638`. Con quello la connessione è UP in 83 ms
   (SQL Anywhere 12.0.1.4436, db `infinity01`). In alternativa si corregge la porta nel DSN.
2. **Permessi diversi da `infinity02`.** L'utenza `lrossi_db` sta solo in `PUBLIC` e ha la
   SELECT diretta su `tdo_pre`, `telefono`, `tipi_doc`, `off_veicoli`, `mdm_pre_inc`, ma la lettura
   fallisce ugualmente perché alcune **colonne calcolate e viste richiamano funzioni** concesse solo
   al gruppo `utenti_infinity`: `tdo_pre.id_utente = dba.fn_getidutenticoll_doc(...)`,
   `telefono.id_utente = dba.fn_getidutenticoll()`, la vista `clienti` usa `fn_get_last_email`.
   Finché mancano questi grant **nessuna prenotazione è leggibile** da `infinity01`.

La verifica accessi (`npm run infinity:check`) ora riconosce dal messaggio d'errore la funzione
negata e propone l'`EXECUTE` su quella. Richiesta minima per `lrossi_db`, in ordine di importanza:

```sql
GRANT EXECUTE ON dba.fn_getidutenticoll_doc TO lrossi_db;  -- OBBLIGATORIO: colonna calcolata di tdo_pre
GRANT EXECUTE ON dba.fn_get_last_email TO lrossi_db;       -- OBBLIGATORIO: vista clienti (nome cliente, cellulare)
GRANT EXECUTE ON dba.fn_getidutenticoll TO lrossi_db;      -- consigliato: colonna calcolata di telefono
GRANT SELECT  ON dba.contatti TO lrossi_db;                -- facoltativo: referente della prenotazione
GRANT EXECUTE ON dba.sp_off_docs_planning TO lrossi_db;    -- consigliato: planning nativo (cancellate, chiuse, commesse)
```

Alternativa più ampia, sconsigliata per il minimo privilegio: `GRANT MEMBERSHIP IN GROUP
utenti_infinity TO lrossi_db`. Su `infinity01` i tipi documento attivi sono `PR01` (Bari, sede
`01`) e `PR40` (Massafra, sede `04`).

### Seconda verifica dopo i primi grant (2026-09-16)

Con i cinque grant sopra la verifica passa su `tdo_pre`, `telefono` e `sp_off_docs_planning`: la
sorgente è `procedure` e la procedura restituisce i **dati veri**. Il 2026-09-16 a Bari (sede `01`)
40 prenotazioni `PR01`: 16 «Appuntamento», 3 «Prenotazione», 19 già chiuse in commessa, 2 annullate;
il 2026-09-17 sono 42. Accettatori risolti per matricola da `o_operai`. Restano negate le viste
`clienti` e `contatti`, e il catalogo (`SYS.SYSVIEWS`, `SYS.SYSTABCOL`, `SYS.SYSDEPENDENCY`,
`SYS.SYSPROCPERM`, sola lettura) dice esattamente perché: due funzioni concesse solo a
`utenti_infinity`.

```sql
GRANT EXECUTE ON dba.fn_get_cons_privacy TO lrossi_db;     -- nel testo delle viste clienti e contatti (colonna cons_privacy)
GRANT EXECUTE ON dba.fn_rimuovi_doppi_spazi TO lrossi_db;  -- colonna calcolata anagrafica.ipp_search: anagrafica sta sotto la vista clienti
```

La vista `clienti` poggia su `anagrafica`, `clienti_base`, `nazione` e `telefono` (tutte con SELECT
concessa) e non cita altre funzioni oltre a `fn_get_last_email` (già concessa) e
`fn_get_cons_privacy`: con questi due grant la lista dovrebbe chiudersi. Resta negata solo
`fn_off_doc_vei_cortesia`, che non serve.

Nel frattempo l'adapter **non si ferma**: se la vista `clienti` è negata rilegge il planning senza
il join sull'anagrafica (avviso una volta sola; `healthCheck` aggiunge «anagrafica non leggibile»).
I clienti compaiono come «Cliente <id>» e il cellulare arriva solo dalla tabella `telefono`; al
primo sync dopo i grant (e il riavvio del processo) nomi e telefoni si completano per le pratiche
ancora in attesa.

Altre due cose viste solo sui dati veri. La prima: il database è in **windows-1252** e il modulo
`odbc` legge le stringhe come UTF-8, quindi «ANDRÀ» arrivava come «ANDR�»; la stringa di connessione
ora porta sempre `CharSet=UTF-8` (il driver converte; si cambia da `INFINITY_ODBC_EXTRA`). La
seconda: per una prenotazione già trasformata in commessa (veicolo accettato in Infinity) la
procedura riporta tipo, numero, anno e data della **commessa** (`LO01 266158/2026`; stato 10
«Accettata», 11 «In lavorazione», 17 «Fatturato/consegnato»), non della prenotazione `PR01`.
Filtro e colonne di testata leggono perciò quelli della prenotazione in `tdo_pre`
(`COALESCE(p.tipo_doc, tab.tipo_doc)` ecc.): con il filtro precedente 19 pratiche su 40 sarebbero
sparite dall'agenda a metà giornata e la sync le avrebbe annullate. Con `INFINITY_INCLUDE_WORK_ORDERS=true` entrano anche le
commesse della sede (genere `L`).

## 7. Limiti riscontrati su `infinity02`

1. **Targhe solo dagli invii FAL.** `tdo_pre.id_veicoliofficina` è vuoto in tutta la copia di
   prova; la targa si ricava dall'ultimo `off_invii_fal` del documento (circa metà delle
   prenotazioni). La procedura restituisce `id_veicolo` e `targa` direttamente: con il grant il
   problema dovrebbe sparire. Verificare su `infinity01`.
2. **Copia di prova ferma a novembre 2024.** La sync della giornata corrente su `infinity02`
   restituisce zero prenotazioni: per vedere dati usare `INFINITY_ODBC_DATE` con una giornata del
   2023-2024 (es. `2023-12-28`).
3. **Modalità mock e seed demo.** Con `INFINITY_PROVIDER=real` il container rifiuta il seed con
   credenziali demo e richiede `SESSION_SECRET`: passare a `real` solo con operatori reali (M9).
4. **Descrizione modello con marca ripetuta** in alcuni record (`off_modelli.descrizione` =
   "FIAT 500X"): cosmetico, non corretto dall'adapter.

## 8. Passaggio a `infinity01`

1. Creare (o verificare) il DSN di sistema a 64 bit `Infinity01` con lo stesso driver, host e
   credenziali di produzione memorizzate nel DSN (o in `INFINITY_ODBC_UID/PWD` di `.env.local`).
2. Chiedere all'IT del gestionale i GRANT di §6bis: la procedura del planning e le funzioni
   richiamate da colonne calcolate e dalla vista `clienti`. `npm run infinity:check` stampa quelli
   ancora mancanti; finché manca la vista `clienti` il planning si legge con i clienti come
   «Cliente <id>».
3. In `.env.local`: `INFINITY_ODBC_DSN=Infinity01`, `INFINITY_BOOKING_DOC_TYPES` con i tipi
   documento dell'officina servita (es. `PR01`), `INFINITY_SEDE` se si vuole forzare la sede.
4. `npm run infinity:check` con `INFINITY_ODBC_DSN=Infinity01` e la giornata di oggi: la verifica
   accessi deve dire "nessun GRANT da richiedere" (o elencare solo facoltativi), la sorgente del
   planning deve essere `procedure` e il planning deve stampare targhe, nomi e lavorazioni.
5. Solo dopo: `SEED_PROFILE=real` con `SEED_ADMIN_PASSWORD_HASH`, `SEED_DISPLAY_TOKEN_SECRET` e
   `SESSION_SECRET` generati da `npm run seed:credenziali` (il container rifiuta il seed demo con un
   provider reale), poi `INFINITY_PROVIDER=real` e riavvio. `/api/v1/health` mostra la porta Infinity
   `real` con versione del motore, database e sorgente; il primo accesso è `admin` con la password
   provvisoria, da cambiare subito.
6. Rollback immediato: `INFINITY_PROVIDER=mock`.

### 8bis. Prima esecuzione dell'app sui dati reali (2026-09-16)

Con `SEED_PROFILE=real` e `INFINITY_PROVIDER=real` il server di sviluppo è partito al primo colpo:
`/api/v1/health` → Infinity `real`, UP in 78 ms (`sql_anywhere_12 · DSN Infinity01 · db infinity01 ·
versione 12.0.1.4436 · utente lrossi_db`); sync di avvio `SUCCESS` con 40 appuntamenti ricevuti,
38 pratiche create (le 2 annullate in Infinity non entrano in coda), 0 scartate: tutti i marchi del
planning (Fiat, Jeep, Lancia, Alfa Romeo, Peugeot, Citroën, DS, Leapmotor, EMC, XEV) hanno il loro
marchio nel seed. La coda di `/accettazione` mostra le pratiche vere con codice, orario, targa,
veicolo, cliente e lavorazioni; il filtro per sportello segue i marchi (S1 Stellantis Italia: 20
pratiche). Il portale cliente risponde alla targa vera con la posizione in coda. I promemoria del
giorno stesso sono partiti in DRY-RUN: 38 candidati, 32 verso il ripiego SMS (provider mock: nessun
invio) perché nessun cliente ha il consenso WhatsApp in anagrafica, 4 senza recapito. Nessun cliente
reale è stato contattato.

Da tenere presente:

- una sync fatta a metà mattina mette subito fra «in ritardo / assenti» le prenotazioni delle 08:00:
  in esercizio la sync delle 06:00 le fa nascere in attesa;
- le prenotazioni già «Chiusa in ODL» (veicolo accettato in Infinity) **nascono completate** e non
  ricevono promemoria (`closedInDms` nel DTO, deciso il 2026-09-16); se la chiusura arriva a metà
  giornata, alla sync successiva la pratica ancora in attesa (o segnata assente) passa a completata,
  una presa in carico resta all'operatore;
- nessun cliente ha l'opt-in WhatsApp in anagrafica: con `SPOKI_OVERRIDE_CONSENT=true` i promemoria
  (comunicazioni di servizio) tentano comunque WhatsApp; il guardrail degli invii reali non cambia;
- il saluto dei messaggi per le aziende (nome vuoto in anagrafica) usa ora la ragione sociale;
- le righe `L` della procedura (`tipo = 'R'`, 33 il 2026-09-16 a Bari) sono le **riconsegne**:
  commesse con consegna prevista nella giornata, con stato in officina (10 Accettata, 11 In
  lavorazione, 13 Collaudato, 15 Fatturato non consegnato, 17 Fatturato/consegnato). Dal
  2026-09-16 al 2026-09-24 sono entrate come flusso RETURN (scheda «Riconsegne», codici `R001…`);
  dal 2026-09-24 la sezione non esiste più e l'adapter le scarta sempre; le righe `Z` con `tipo`
  `A`/`C` sono invece prenotazioni ancora appuntamento (A) o già trasformate in commessa (C).

## 9. File

- `src/infrastructure/adapters/infinity/infinity-odbc-config.ts`: tipo di configurazione
  (DSN, motore, sorgente del planning, sede), stringa di connessione con escape ODBC, descrizione
  per i log senza password.
- `src/infrastructure/adapters/infinity/OdbcClient.ts`: `IOdbcClient` e `SqlAnywhereOdbcClient`
  (connessione per query, import dinamico del modulo nativo).
- `src/infrastructure/adapters/infinity/infinity-planning-query.ts`: le due SQL della testata,
  le query di arricchimento, coercizione dei valori del driver, `InfinityPlanningRecord`, stati
  documento, nome cliente, mappatura verso `InfinityAgendaDto`.
- `src/infrastructure/adapters/infinity/InfinityServiceOdbc.ts`: la porta; scelta della sorgente
  con ripiego; `checkAccess` (verifica permessi e GRANT suggeriti); classificazione degli errori
  ODBC in `ProviderError` (`TIMEOUT`, `NETWORK`, `AUTH`, `INVALID_REQUEST`).
- `src/config/infinity.ts`: lettura delle variabili d'ambiente con errori di configurazione
  espliciti all'avvio.
- `tests/unit/infinity-odbc-adapter.test.ts` (23 casi senza database),
  `tests/unit/infinity-config.test.ts` (6 casi) e `tests/integration/infinity-odbc.test.ts`
  (4 casi sul database reale, saltati senza DSN).
