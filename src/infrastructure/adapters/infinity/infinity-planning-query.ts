// Query e mappatura del Planning Appuntamenti Clienti di Infinity (Zucchetti, SQL Anywhere 12).
//
// Due sorgenti equivalenti, stesse colonne in uscita (così il parser è uno solo):
// - PROCEDURA `sp_off_docs_planning(data, sede, accettatore, puntovendita, gruppoQualifica, aperte)`:
//   è la stessa procedura che alimenta il planning di Infinity (query nativa vista con Ctrl+Shift+F9).
//   Restituisce prenotazioni (genere_doc 'Z') e commesse in consegna ('L') con i flag
//   deleted/closed/pren_closed/confermato. Richiede GRANT EXECUTE all'utenza del DSN.
// - TABELLE: `tdo_pre` (testata prenotazione) con veicolo da `off_veicoli` o dall'ultimo invio FAL.
//   Funziona con la sola SELECT; non conosce le prenotazioni cancellate.
//
// Arricchimenti comuni (sola SELECT):
// - clienti (vista)     ragione sociale, cognome/nome, recapito per le notifiche
//                       (indirizzo_notifiche con pref_invio_notifiche 'S' = cellulare), telefoni,
//                       consenso privacy. Su infinity01 la vista richiama `fn_get_cons_privacy` e
//                       poggia su `anagrafica` (colonna calcolata con `fn_rimuovi_doppi_spazi`):
//                       senza quei GRANT il planning si legge SENZA anagrafica (`withCustomer`
//                       false: colonne cliente a NULL, nomi "Cliente <id>", cellulare da `telefono`).
// - contatti            referente della prenotazione (codice_contatto).
// - o_operai            accettatore: matricola → nome.
// - off_marche / off_modelli   descrizione di marca e modello.
// - off_tipi_intervento tipo intervento (1 Prevendita, 2 Postvendita).
// - mdm_pre_inc         righe della prenotazione: le LAVORAZIONI richieste (descr_inconveniente,
//                       tempo_stimato), agganciate per (anno, id_cliente, tipo_doc, data_doc, numero_doc).
// - vs_off_inc_tipoinc  tempi per tipo di incarico (Tagliando, Generico…) con ore stimate.
// - telefono            cellulari per id_anagrafica (tipo 'C', usa_per_notifiche).
// - default_generali    cliente "generico" della sede: in quel caso il nome sta in note_cliente.
// Parti della query nativa NON riprodotte, perché legate alla sessione dell'utente Infinity o
// fuori perimetro: il colore della riga (fn_getpermessoutente, utente_coll, vs_off_color_planning
// → fn_getRGB), il veicolo di cortesia (fn_off_doc_vei_cortesia), l'utente creatore.
// Tutto in sola lettura. La mappatura verso il DTO dell'applicazione sta qui, in funzioni pure.
import type { InfinityAgendaDto, InfinityAppointmentDto } from '@/services/dto/infinity.dto';
import type { IsoDate, IsoDateTime } from '@/domain/value-objects/iso-date';
import { isoDateTime } from '@/domain/value-objects/iso-date';
import { buildLocalDateTime } from '@/lib/dates';
import type { OdbcRow } from './OdbcClient';

/** Tempo stimato per tipo di incarico (da vs_off_inc_tipoinc). */
export interface InfinityTempoIncarico {
  readonly codice: string;
  readonly descrizione: string;
  readonly ore: number;
  readonly numero: number;
}

/** Una prenotazione del planning con tutti i campi che servono all'accettazione. */
export interface InfinityPlanningRecord {
  /** 'Z' prenotazione, 'L' commessa (veicolo in officina con consegna prevista). */
  readonly genereDoc: 'Z' | 'L';
  readonly idDocumento: number;
  /** Commessa aperta dalla prenotazione, se già esiste. */
  readonly idCommessa: number | null;
  readonly tipoDoc: string;
  readonly tipoDocDescrizione: string | null;
  readonly sede: string | null;
  readonly numDoc: number;
  readonly anno: number | null;
  readonly dataDoc: string | null;
  readonly idCliente: number;
  /** Ragione sociale (o note_cliente per il cliente generico della sede); null se non leggibile. */
  readonly cliente: string | null;
  readonly clienteCognome: string | null;
  readonly clienteNome: string | null;
  readonly clienteGenerico: boolean;
  /** Consenso privacy in anagrafica (S/N); null se ignoto. Non è il consenso WhatsApp. */
  readonly consensoPrivacy: boolean | null;
  /** Referente indicato sulla prenotazione (tabella contatti). */
  readonly contatto: string | null;
  readonly proprietarioId: number | null;
  readonly dataPrenotazione: IsoDate;
  /** "HH:mm"; "08:00" se assente. */
  readonly oraPrenotazione: string;
  readonly dataPrevCons: string | null;
  readonly oraPrevCons: string | null;
  readonly accettatoreCodice: string | null;
  readonly accettatoreNome: string | null;
  readonly tipoIntervento: string | null;
  readonly tipoInterventoDescrizione: string | null;
  readonly confermato: boolean;
  readonly clienteInSala: boolean;
  /** Prenotazione cancellata in Infinity (flag deleted della procedura o stato documento "Annullata"). */
  readonly annullata: boolean;
  /** Documento chiuso (closed/pren_closed della procedura o stato documento "Chiusa in ODL"). */
  readonly chiusa: boolean;
  readonly statoDocId: number | null;
  /** Descrizione dello stato documento (off_stati_doc), es. "Appuntamento", "Annullata". */
  readonly statoDocDescrizione: string | null;
  readonly ordineLavoro: string | null;
  readonly idVeicolo: number | null;
  readonly targa: string | null;
  readonly telaio: string | null;
  readonly marcaCodice: string | null;
  readonly marcaDescrizione: string | null;
  readonly modelloCodice: string | null;
  readonly modelloDescrizione: string | null;
  readonly telefono: string | null;
  readonly noteDoc: string | null;
  readonly noteCliente: string | null;
  /** Lavorazioni richieste (righe mdm_pre_inc), nell'ordine delle righe. */
  readonly lavorazioni: readonly string[];
  readonly tempi: readonly InfinityTempoIncarico[];
  /** Ore stimate complessive (somma dei tempi), null se nessuna riga. */
  readonly tempoStimatoOre: number | null;
  readonly dataModifica: string | null;
}

/** Placeholder per la SQL: `?` per ogni valore. */
function placeholders(n: number): string {
  return Array.from({ length: Math.max(1, n) }, () => '?').join(', ');
}

/** Varianti della SQL del planning. */
export interface PlanningSqlOptions {
  /** false = nessun join su clienti/contatti (vista negata): stesse colonne cliente, a NULL. Default true. */
  readonly withCustomer?: boolean;
  /** true = anche le commesse senza prenotazione (genere L). Default false. */
  readonly includeWorkOrders?: boolean;
}

/**
 * Colonne di arricchimento comuni alle due sorgenti; `x` è l'alias della riga di testata e `doc`
 * dice da dove leggere tipo, numero, anno e data del documento (per la procedura: dalla
 * prenotazione in tdo_pre, che per una pratica già in commessa differiscono dalla riga).
 */
function commonColumns(
  x: string,
  withCustomer: boolean,
  doc: (col: string) => string = (col) => `${x}.${col}`,
): string {
  // Senza anagrafica le colonne restano, a NULL: il parser è uno solo.
  const cliente = withCustomer
    ? `
  c.ragione_sociale AS cliente, c.cognome AS cliente_cognome, c.nome AS cliente_nome, c.cons_privacy,
  c.pref_invio_notifiche, c.indirizzo_notifiche,
  c.telefono1 AS tel_cliente1, c.telefono2 AS tel_cliente2, c.telefono3 AS tel_cliente3,
  ${x}.codice_contatto, ct.ragione_sociale AS contatto, ct.cellulare AS contatto_cellulare,`
    : `
  CAST(NULL AS VARCHAR(80)) AS cliente, CAST(NULL AS VARCHAR(80)) AS cliente_cognome, CAST(NULL AS VARCHAR(80)) AS cliente_nome, CAST(NULL AS CHAR(1)) AS cons_privacy,
  CAST(NULL AS CHAR(1)) AS pref_invio_notifiche, CAST(NULL AS VARCHAR(80)) AS indirizzo_notifiche,
  CAST(NULL AS VARCHAR(30)) AS tel_cliente1, CAST(NULL AS VARCHAR(30)) AS tel_cliente2, CAST(NULL AS VARCHAR(30)) AS tel_cliente3,
  ${x}.codice_contatto, CAST(NULL AS VARCHAR(80)) AS contatto, CAST(NULL AS VARCHAR(30)) AS contatto_cellulare,`;
  return `
  ${doc('anno')} AS anno, ${doc('tipo_doc')} AS tipo_doc, td.descrizione AS tipo_doc_descr, TRIM(td.sede_cont) AS sede,
  (SELECT MAX(dg.id_cliente_def) FROM {s}.default_generali dg WHERE dg.codice = td.sede_cont) AS id_cliente_generico,
  ${doc('num_doc')} AS num_doc, ${doc('data_doc')} AS data_doc, ${x}.id_cliente,${cliente}
  TRIM(${x}.accettatore_prenotazione) AS accettatore_cod, op.nome AS accettatore_nome,
  ${x}.tipo_intervento, ti.descrizione AS tipo_intervento_descr,
  ${x}.confermato, ${x}.flag_clienteinsala, ${x}.id_stato_doc, sd.descrizione AS stato_doc_descr, ${x}.order_id,
  ${x}.note_doc, ${x}.note_cliente,`;
}

function commonJoins(x: string, withCustomer: boolean, tipoDoc = `${x}.tipo_doc`): string {
  const anagrafica = withCustomer
    ? `
LEFT JOIN {s}.clienti c ON c.codice_cliente = ${x}.id_cliente
LEFT JOIN {s}.contatti ct ON ct.codice_contatto = ${x}.codice_contatto`
    : '';
  return `
JOIN {s}.tipi_doc td ON td.codice = ${tipoDoc}${anagrafica}
LEFT JOIN {s}.o_operai op ON TRIM(op.matricola) = TRIM(${x}.accettatore_prenotazione)
LEFT JOIN {s}.off_tipi_intervento ti ON ti.codice = ${x}.tipo_intervento
LEFT JOIN {s}.off_stati_doc sd ON sd.id = ${x}.id_stato_doc`;
}

/**
 * Stati documento di Infinity (off_stati_doc): 0 Appuntamento, 1 Prenotazione, 2 Preventivo,
 * 3 Chiusa in ODL, 4 e 18 Annullata, 10+ stati della commessa. Si riconoscono dalla descrizione,
 * con gli id come riserva: così la cancellazione si vede anche leggendo le tabelle senza procedura.
 */
const STATI_ANNULLATA = new Set([4, 18]);
const STATI_CHIUSA = new Set([3]);

export function isStatoAnnullato(id: number | null, descrizione: string | null): boolean {
  return (
    (descrizione !== null && /annull|cancell/i.test(descrizione)) ||
    (id !== null && STATI_ANNULLATA.has(id))
  );
}

export function isStatoChiuso(id: number | null, descrizione: string | null): boolean {
  return (
    (descrizione !== null && /chius/i.test(descrizione)) || (id !== null && STATI_CHIUSA.has(id))
  );
}

/**
 * Planning dalla PROCEDURA nativa. Parametri posizionali: giornata, sede, poi i tipi documento,
 * poi l'eventuale targa. `as_accettatore = 'T'` (tutti), nessun punto vendita, gruppo qualifica 0,
 * `ai_aperte = 0` (solo la giornata richiesta), come i default dichiarati dalla procedura.
 *
 * Per una prenotazione già trasformata in commessa (veicolo accettato in Infinity) la procedura
 * riporta tipo, numero, anno e data della COMMESSA (LO01 266158/2026…), non della prenotazione:
 * filtro e colonne di testata leggono quelli della prenotazione in `tdo_pre` (COALESCE con la riga,
 * per le commesse senza prenotazione), così la pratica non sparisce dall'agenda quando il cliente
 * arriva e resta `PR01 5721/2026` come sul planning.
 */
export function planningProcedureSql(
  schema: string,
  docTypesCount: number,
  withPlateFilter = false,
  options: PlanningSqlOptions = {},
): string {
  const withCustomer = options.withCustomer !== false;
  const doc = (col: string): string => `COALESCE(p.${col}, tab.${col})`;
  const tipoDoc = `${doc('tipo_doc')} IN (${placeholders(docTypesCount)})`;
  const filtro =
    options.includeWorkOrders === true ? `(tab.genere_doc = 'L' OR ${tipoDoc})` : tipoDoc;
  return `
SELECT
  tab.genere_doc, tab.id_documento, tab.id_commessa, tab.tipo AS tipo_riga,
  tab.data_prenotazione, tab.ora_prenotazione,
  COALESCE(tab.doc_data_prevcons, tab.data_prevcons) AS data_prevcons,
  COALESCE(tab.doc_ora_prevcons, tab.ora_prevcons) AS ora_prevcons,${commonColumns('tab', withCustomer, doc)}
  tab.proprietario, tab.closed, tab.deleted, tab.pren_closed,
  p.ordine_lavoro, p.data_modifica, p.data_creazione,
  tab.id_veicolo, tab.targa, tab.telaio, tab.cod_marca, m.descrizione AS marca_descr,
  tab.cod_modello, mo.descrizione AS modello_descr, CAST(NULL AS VARCHAR(80)) AS modello_comm
FROM {s}.sp_off_docs_planning(?, ?, 'T', NULL, 0, 0) tab
LEFT JOIN {s}.tdo_pre p ON p.id_documento = tab.id_documento${commonJoins('tab', withCustomer, doc('tipo_doc'))}
LEFT JOIN {s}.off_marche m ON m.cod_marca = tab.cod_marca
LEFT JOIN {s}.off_modelli mo ON mo.cod_marca = tab.cod_marca AND mo.cod_modello = tab.cod_modello
WHERE ${filtro}${
    withPlateFilter
      ? `
  AND UPPER(REPLACE(tab.targa, ' ', '')) = ?`
      : ''
  }
ORDER BY COALESCE(tab.ora_prenotazione, tab.doc_ora_prevcons), ${doc('num_doc')}`
    .replace(/\{s\}/g, schema)
    .trim();
}

/**
 * Planning dalle TABELLE (ripiego senza GRANT). Parametri: giornata, tipi documento, eventuale targa.
 * La targa arriva, nell'ordine, dal veicolo collegato alla prenotazione, dall'ultimo invio FAL del
 * documento, dal veicolo di quell'invio.
 */
export function planningTablesSql(
  schema: string,
  docTypesCount: number,
  withPlateFilter = false,
  options: PlanningSqlOptions = {},
): string {
  const withCustomer = options.withCustomer !== false;
  return `
SELECT
  'Z' AS genere_doc, p.id_documento, CAST(NULL AS INTEGER) AS id_commessa, CAST(NULL AS VARCHAR(1)) AS tipo_riga,
  p.data_prenotazione, p.ora_prenotazione, p.data_prevcons, p.ora_prevcons,${commonColumns('p', withCustomer)}
  CAST(NULL AS INTEGER) AS proprietario, 0 AS closed, 0 AS deleted, 0 AS pren_closed,
  p.ordine_lavoro, p.data_modifica, p.data_creazione,
  COALESCE(v1.id_veicolo, v2.id_veicolo) AS id_veicolo,
  COALESCE(v1.targa, fal.targa, v2.targa) AS targa,
  COALESCE(v1.telaio, v2.telaio) AS telaio,
  COALESCE(v1.cod_marca, v2.cod_marca) AS cod_marca, m.descrizione AS marca_descr,
  COALESCE(v1.cod_modello, v2.cod_modello) AS cod_modello, mo.descrizione AS modello_descr,
  COALESCE(v1.modello_comm, v2.modello_comm) AS modello_comm
FROM {s}.tdo_pre p${commonJoins('p', withCustomer)}
LEFT JOIN {s}.off_veicoli v1 ON v1.id_veicolo = p.id_veicoliofficina
LEFT JOIN (
  SELECT f.id_documento, MAX(f.id) AS id
  FROM {s}.off_invii_fal f
  WHERE f.targa IS NOT NULL
  GROUP BY f.id_documento
) fl ON fl.id_documento = p.id_documento
LEFT JOIN {s}.off_invii_fal fal ON fal.id = fl.id
LEFT JOIN {s}.off_veicoli v2 ON v2.id_veicolo = fal.id_veicolo
LEFT JOIN {s}.off_marche m ON m.cod_marca = COALESCE(v1.cod_marca, v2.cod_marca)
LEFT JOIN {s}.off_modelli mo ON mo.cod_marca = COALESCE(v1.cod_marca, v2.cod_marca)
  AND mo.cod_modello = COALESCE(v1.cod_modello, v2.cod_modello)
WHERE p.data_prenotazione = ?
  AND p.tipo_doc IN (${placeholders(docTypesCount)})${
    withPlateFilter
      ? `
  AND UPPER(REPLACE(COALESCE(v1.targa, fal.targa, v2.targa), ' ', '')) = ?`
      : ''
  }
ORDER BY p.ora_prenotazione, p.num_doc`
    .replace(/\{s\}/g, schema)
    .trim();
}

/** Sedi (tipi_doc.sede_cont) dei tipi documento configurati: parametro `as_sede` della procedura. */
export function sediSql(schema: string, docTypesCount: number): string {
  return `
SELECT DISTINCT TRIM(td.sede_cont) AS sede
FROM ${schema}.tipi_doc td
WHERE td.codice IN (${placeholders(docTypesCount)}) AND td.sede_cont IS NOT NULL`.trim();
}

/** Lavorazioni richieste: righe della prenotazione (mdm_pre_inc) per un elenco di documenti. */
export function linesSql(schema: string, idsCount: number): string {
  return `
SELECT t.id_documento, i.id_riga, i.tipo_riga, i.inconveniente, i.descr_inconveniente, i.tempo_stimato
FROM ${schema}.mdm_pre_inc i
JOIN ${schema}.tdo_pre t ON i.anno = t.anno AND i.id_cliente = t.id_cliente AND i.tipo_doc = t.tipo_doc
  AND i.data_doc = t.data_doc AND i.numero_doc = t.num_doc
WHERE t.id_documento IN (${placeholders(idsCount)})
ORDER BY t.id_documento, i.id_riga`.trim();
}

/** Tempi stimati per tipo di incarico (vs_off_inc_tipoinc) per un elenco di prenotazioni. */
export function tempiSql(schema: string, idsCount: number): string {
  return `
SELECT inct.id_documento, TRIM(inct.codice) AS codice, TRIM(inct.descrizione) AS descrizione,
  SUM(COALESCE(inct.tempo_stimato, 0)) AS ore, COUNT(*) AS numero
FROM ${schema}.vs_off_inc_tipoinc inct
WHERE inct.genere_doc = 'Z' AND inct.id_documento IN (${placeholders(idsCount)})
GROUP BY inct.id_documento, inct.codice, inct.descrizione
ORDER BY inct.id_documento, inct.codice`.trim();
}

/** Cellulari validi dei clienti indicati; `usa_per_notifiche` = 'S' è il preferito. */
export function phonesSql(schema: string, idsCount: number): string {
  return `
SELECT t.id_anagrafica, t.num_riferimento, t.usa_per_notifiche
FROM ${schema}.telefono t
WHERE t.tipo = 'C' AND t.valido = 1 AND t.num_riferimento IS NOT NULL
  AND t.id_anagrafica IN (${placeholders(idsCount)})
ORDER BY t.id_anagrafica, t.id_telefono`.trim();
}

/** Verifica di connessione: versione del motore e nome del database. */
export function healthSql(): string {
  return "SELECT PROPERTY('ProductVersion') AS versione, DB_NAME() AS db, CURRENT USER AS utente";
}

// --- coercizioni dai valori grezzi del driver ---------------------------------------------

function text(v: unknown): string | null {
  if (v === null || v === undefined) {
    return null;
  }
  const s = String(v).trim();
  return s === '' ? null : s;
}

function integer(v: unknown): number | null {
  if (v === null || v === undefined || v === '') {
    return null;
  }
  const n = typeof v === 'number' ? v : Number.parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

/** Somme di decimali binari (0.1 + 0.2) riportate a due cifre. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function decimal(v: unknown): number | null {
  if (v === null || v === undefined || v === '') {
    return null;
  }
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function flag(v: unknown): boolean {
  return v === 1 || v === '1' || v === true || v === 'S' || v === 's';
}

/** S/N → boolean; altro → null. */
function yesNo(v: unknown): boolean | null {
  const s = text(v)?.toUpperCase();
  if (s === 'S' || s === '1') {
    return true;
  }
  if (s === 'N' || s === '0') {
    return false;
  }
  return null;
}

/** "YYYY-MM-DD" da una Date o da una stringa "YYYY-MM-DD[ HH:mm:ss]". */
function dateOnly(v: unknown): string | null {
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  }
  const s = text(v);
  const m = s?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m === null || m === undefined ? null : `${m[1]}-${m[2]}-${m[3]}`;
}

/** "HH:mm" da una stringa "HH:mm[:ss]" o da una Date. */
function timeHHmm(v: unknown): string | null {
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(11, 16);
  }
  const s = text(v);
  const m = s?.match(/(\d{1,2}):(\d{2})/);
  return m === null || m === undefined ? null : `${m[1]?.padStart(2, '0')}:${m[2]}`;
}

/** Istante ISO da un timestamp del driver (Date o stringa), oppure null. */
function timestampIso(v: unknown): string | null {
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : v.toISOString();
  }
  const s = text(v);
  if (s === null) {
    return null;
  }
  const d = new Date(s.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Numero di cellulare italiano plausibile (3xx…), ripulito da spazi e separatori. */
function mobileOrNull(v: unknown): string | null {
  const s = text(v)?.replace(/[\s./-]/g, '') ?? null;
  return s !== null && /^(\+39|0039)?3\d{8,9}$/.test(s) ? s : null;
}

export interface LineRow {
  readonly idDocumento: number;
  readonly descrizione: string;
  readonly ore: number | null;
}

export interface TempoRow extends InfinityTempoIncarico {
  readonly idDocumento: number;
}

export interface PhoneRow {
  readonly idAnagrafica: number;
  readonly numero: string;
  readonly perNotifiche: boolean;
}

export function parseLineRows(rows: readonly OdbcRow[]): readonly LineRow[] {
  return rows.flatMap((r) => {
    const id = integer(r['id_documento']);
    const descrizione = text(r['descr_inconveniente']) ?? text(r['inconveniente']);
    return id === null || descrizione === null
      ? []
      : [{ idDocumento: id, descrizione, ore: decimal(r['tempo_stimato']) }];
  });
}

export function parseTempoRows(rows: readonly OdbcRow[]): readonly TempoRow[] {
  return rows.flatMap((r) => {
    const id = integer(r['id_documento']);
    const codice = text(r['codice']);
    if (id === null || codice === null) {
      return [];
    }
    return [
      {
        idDocumento: id,
        codice,
        descrizione: text(r['descrizione']) ?? codice,
        ore: decimal(r['ore']) ?? 0,
        numero: integer(r['numero']) ?? 1,
      },
    ];
  });
}

export function parsePhoneRows(rows: readonly OdbcRow[]): readonly PhoneRow[] {
  return rows.flatMap((r) => {
    const id = integer(r['id_anagrafica']);
    const numero = text(r['num_riferimento']);
    return id === null || numero === null
      ? []
      : [{ idAnagrafica: id, numero, perNotifiche: flag(r['usa_per_notifiche']) }];
  });
}

export interface PlanningRecordsInput {
  readonly rows: readonly OdbcRow[];
  readonly lines: readonly LineRow[];
  readonly tempi: readonly TempoRow[];
  readonly phones: readonly PhoneRow[];
  /** Giornata richiesta: la prenotazione la eredita anche se il driver la restituisce in altro formato. */
  readonly businessDate: IsoDate;
  /** Tenere anche le commesse senza prenotazione (genere L). Default false. */
  readonly includeWorkOrders?: boolean;
}

/**
 * Dalle righe grezze del planning ai record leggibili (funzione pura).
 * Una prenotazione diventata commessa può comparire due volte (Z e L): si tiene la riga con la
 * commessa, così lo stato è quello più avanzato, e l'identificativo resta quello della prenotazione.
 */
export function toPlanningRecords(input: PlanningRecordsInput): readonly InfinityPlanningRecord[] {
  const lavorazioniPer = new Map<number, string[]>();
  for (const l of input.lines) {
    const list = lavorazioniPer.get(l.idDocumento) ?? [];
    list.push(l.descrizione);
    lavorazioniPer.set(l.idDocumento, list);
  }
  const tempiPer = new Map<number, InfinityTempoIncarico[]>();
  for (const t of input.tempi) {
    const list = tempiPer.get(t.idDocumento) ?? [];
    list.push({ codice: t.codice, descrizione: t.descrizione, ore: t.ore, numero: t.numero });
    tempiPer.set(t.idDocumento, list);
  }
  // Cellulare dalla tabella telefono: si ricorda se è quello marcato per le notifiche.
  const telefonoPer = new Map<number, { numero: string; perNotifiche: boolean }>();
  for (const p of input.phones) {
    const attuale = telefonoPer.get(p.idAnagrafica);
    if (attuale === undefined || (p.perNotifiche && !attuale.perNotifiche)) {
      telefonoPer.set(p.idAnagrafica, { numero: p.numero, perNotifiche: p.perNotifiche });
    }
  }

  const perChiave = new Map<string, InfinityPlanningRecord>();
  for (const row of input.rows) {
    const idDocumento = integer(row['id_documento']);
    const idCommessa = integer(row['id_commessa']);
    const numDoc = integer(row['num_doc']);
    const idCliente = integer(row['id_cliente']);
    const tipoDoc = text(row['tipo_doc']);
    if (numDoc === null || idCliente === null || tipoDoc === null) {
      continue;
    }
    if (idDocumento === null && (idCommessa === null || input.includeWorkOrders !== true)) {
      continue;
    }
    const genereDoc: 'Z' | 'L' = text(row['genere_doc'])?.toUpperCase() === 'L' ? 'L' : 'Z';
    const idClienteGenerico = integer(row['id_cliente_generico']);
    const clienteGenerico = idClienteGenerico !== null && idClienteGenerico === idCliente;
    const noteCliente = text(row['note_cliente']);
    const ragioneSociale = text(row['cliente']);
    const cliente = clienteGenerico ? (noteCliente ?? ragioneSociale) : ragioneSociale;
    const chiaveDoc = idDocumento ?? (idCommessa as number);
    const lavorazioni = lavorazioniPer.get(chiaveDoc) ?? [];
    const tempi = tempiPer.get(chiaveDoc) ?? [];
    const oreLavorazioni = input.lines
      .filter((l) => l.idDocumento === chiaveDoc && l.ore !== null)
      .reduce((acc, l) => acc + (l.ore ?? 0), 0);
    const oreTempi = tempi.reduce((acc, t) => acc + t.ore, 0);
    const tempoStimatoOre =
      tempi.length > 0 ? round2(oreTempi) : lavorazioni.length > 0 ? round2(oreLavorazioni) : null;
    // Ordine: cellulare marcato per le notifiche in `telefono`; recapito notifiche in anagrafica
    // (pref_invio_notifiche 'S' = SMS/cellulare); altro cellulare in `telefono`; telefoni generici;
    // cellulare del referente.
    const daTelefono = telefonoPer.get(idCliente);
    const recapitoNotifiche =
      text(row['pref_invio_notifiche'])?.toUpperCase() === 'E'
        ? null
        : mobileOrNull(row['indirizzo_notifiche']);
    const telefono =
      (daTelefono?.perNotifiche === true ? daTelefono.numero : null) ??
      recapitoNotifiche ??
      daTelefono?.numero ??
      mobileOrNull(row['tel_cliente1']) ??
      mobileOrNull(row['tel_cliente2']) ??
      mobileOrNull(row['tel_cliente3']) ??
      mobileOrNull(row['contatto_cellulare']);

    const record: InfinityPlanningRecord = {
      genereDoc,
      idDocumento: chiaveDoc,
      idCommessa,
      tipoDoc,
      tipoDocDescrizione: text(row['tipo_doc_descr']),
      sede: text(row['sede']),
      numDoc,
      anno: integer(row['anno']),
      dataDoc: dateOnly(row['data_doc']),
      idCliente,
      cliente,
      clienteCognome: clienteGenerico ? null : text(row['cliente_cognome']),
      clienteNome: clienteGenerico ? null : text(row['cliente_nome']),
      clienteGenerico,
      consensoPrivacy: yesNo(row['cons_privacy']),
      contatto: text(row['contatto']),
      proprietarioId: integer(row['proprietario']),
      dataPrenotazione: (dateOnly(row['data_prenotazione']) ??
        dateOnly(row['data_prevcons']) ??
        input.businessDate) as IsoDate,
      oraPrenotazione:
        timeHHmm(row['ora_prenotazione']) ?? timeHHmm(row['ora_prevcons']) ?? '08:00',
      dataPrevCons: dateOnly(row['data_prevcons']),
      oraPrevCons: timeHHmm(row['ora_prevcons']),
      accettatoreCodice: text(row['accettatore_cod']),
      accettatoreNome: text(row['accettatore_nome']),
      tipoIntervento: text(row['tipo_intervento']),
      tipoInterventoDescrizione: text(row['tipo_intervento_descr']),
      confermato: flag(row['confermato']),
      clienteInSala: flag(row['flag_clienteinsala']),
      annullata:
        flag(row['deleted']) ||
        isStatoAnnullato(integer(row['id_stato_doc']), text(row['stato_doc_descr'])),
      chiusa:
        flag(row['closed']) ||
        flag(row['pren_closed']) ||
        isStatoChiuso(integer(row['id_stato_doc']), text(row['stato_doc_descr'])),
      statoDocId: integer(row['id_stato_doc']),
      statoDocDescrizione: text(row['stato_doc_descr']),
      ordineLavoro: text(row['ordine_lavoro']) ?? text(row['order_id']),
      idVeicolo: integer(row['id_veicolo']),
      targa: text(row['targa'])?.replace(/\s+/g, '').toUpperCase() ?? null,
      telaio: text(row['telaio']),
      marcaCodice: text(row['cod_marca']),
      marcaDescrizione: text(row['marca_descr']),
      modelloCodice: text(row['cod_modello']),
      modelloDescrizione: text(row['modello_descr']) ?? text(row['modello_comm']),
      telefono,
      noteDoc: text(row['note_doc']),
      noteCliente,
      lavorazioni,
      tempi,
      tempoStimatoOre,
      dataModifica: timestampIso(row['data_modifica']) ?? timestampIso(row['data_creazione']),
    };
    const chiave = idDocumento === null ? `COM-${idCommessa}` : `PRE-${idDocumento}`;
    const esistente = perChiave.get(chiave);
    if (esistente === undefined || (esistente.idCommessa === null && idCommessa !== null)) {
      perChiave.set(chiave, record);
    }
  }
  return [...perChiave.values()];
}

/** Marchi dell'applicazione riconosciuti dalla descrizione Infinity (off_marche.descrizione). */
const BRAND_BY_DESCRIPTION: Readonly<Record<string, string>> = {
  FIAT: 'FIAT',
  JEEP: 'JEEP',
  'ALFA ROMEO': 'ALFA_ROMEO',
  ALFAROMEO: 'ALFA_ROMEO',
  LANCIA: 'LANCIA',
  PEUGEOT: 'PEUGEOT',
  CITROEN: 'CITROEN',
  OPEL: 'OPEL',
};

/** "Citroen" → CITROEN, "Alfa Romeo" → ALFA_ROMEO; sconosciuti → descrizione normalizzata. */
export function brandCodeFromDescription(descrizione: string | null): string {
  if (descrizione === null) {
    return 'SCONOSCIUTA';
  }
  const normalizzata = descrizione
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
  return BRAND_BY_DESCRIPTION[normalizzata] ?? normalizzata.replace(/ /g, '_');
}

/** Descrizione della lavorazione per la coda: righe richieste, poi tipi di incarico, poi note. */
function serviceDescriptionOf(r: InfinityPlanningRecord): string | null {
  const testo =
    r.lavorazioni.length > 0
      ? r.lavorazioni.join(' · ')
      : r.tempi.length > 0
        ? r.tempi.map((t) => t.descrizione).join(' · ')
        : (r.noteCliente ?? r.noteDoc ?? '');
  const pulito = testo.replace(/\s+/g, ' ').trim();
  return pulito === '' ? null : pulito.slice(0, 500);
}

/** Forme societarie ed enti: la ragione sociale non va divisa in cognome e nome. */
const COMPANY_MARKERS =
  /\b(S\.?P\.?A\.?|S\.?R\.?L\.?S?|S\.?N\.?C\.?|S\.?A\.?S\.?|S\.?S\.?|S\.?C\.?A\.?R\.?L\.?|SOC|SOCIETA|COOP(ERATIVA)?|ONLUS|DITTA|IMPRESA|STUDIO|MINISTERO|COMUNE|PROVINCIA|REGIONE|AZIENDA|ASSOCIAZIONE|FONDAZIONE|CONSORZIO|GROUP|AUTO|MOTORS?|RENT(AL)?|LEASING|NOLEGGIO|BANCA|ASSICURAZIONI?|ISTITUTO|SCUOLA|PARROCCHIA|COMPANY|LTD|GMBH|INC|NV|BV|SA|SERVICE|SERVIZI|TRASPORTI|LOGISTICA|COSTRUZIONI|FARMACIA|HOTEL|RISTORANTE|BAR|SNC)\b/i;

export function looksLikeCompany(ragioneSociale: string): boolean {
  return COMPANY_MARKERS.test(ragioneSociale) || /\d/.test(ragioneSociale);
}

/** Nome e cognome del cliente: dalle colonne dedicate se presenti, altrimenti la ragione sociale intera come cognome. */
export function customerNameOf(r: InfinityPlanningRecord): {
  readonly firstName: string;
  readonly lastName: string;
} {
  if (r.clienteCognome !== null) {
    return { firstName: r.clienteNome ?? '', lastName: r.clienteCognome };
  }
  const intero = r.cliente ?? `Cliente ${r.idCliente}`;
  if (
    r.clienteGenerico ||
    r.cliente === null ||
    !/^[A-Z' ]+$/.test(intero) ||
    looksLikeCompany(intero)
  ) {
    // Ragione sociale di un'azienda o testo libero: non si indovina il cognome.
    return { firstName: '', lastName: intero };
  }
  // "COGNOME NOME" com'è in anagrafica per le persone fisiche: il cognome è la prima parola.
  const parti = intero.split(' ');
  return parti.length > 1
    ? { firstName: parti.slice(1).join(' '), lastName: parti[0] ?? intero }
    : { firstName: '', lastName: intero };
}

/** Dal record al DTO che il mapper dell'applicazione già conosce (stesso percorso del mock). */
export function toAppointmentDto(
  r: InfinityPlanningRecord,
  timeZone: string,
  fetchedAt: IsoDateTime,
): InfinityAppointmentDto {
  const nome = customerNameOf(r);
  return {
    externalId: `PRE-${r.idDocumento}`,
    scheduledAt: buildLocalDateTime(r.dataPrenotazione, r.oraPrenotazione, timeZone),
    brandCode: brandCodeFromDescription(r.marcaDescrizione),
    plate: r.targa ?? '',
    vin: r.telaio,
    vehicleModel: r.modelloDescrizione ?? r.modelloCodice ?? 'n/d',
    customer: {
      externalId: String(r.idCliente),
      firstName: nome.firstName,
      lastName: nome.lastName,
      phone: r.telefono,
      email: null,
      // Il consenso in anagrafica (cons_privacy) è quello generale, non quello WhatsApp: resta ignoto.
      whatsappOptIn: null,
    },
    serviceDescription: serviceDescriptionOf(r),
    deskCode: null,
    cancelled: r.annullata,
    updatedAt: r.dataModifica ?? fetchedAt,
  };
}

export function toAgendaDto(
  records: readonly InfinityPlanningRecord[],
  businessDate: IsoDate,
  timeZone: string,
  fetchedAt: IsoDateTime = isoDateTime(new Date()),
): InfinityAgendaDto {
  return {
    businessDate,
    fetchedAt,
    partial: false,
    appointments: records.map((r) => toAppointmentDto(r, timeZone, fetchedAt)),
  };
}
