// Implementazione REALE della porta `IInfinityService` sul database Infinity (Zucchetti) via ODBC.
//
// Legge il Planning Appuntamenti Clienti in sola lettura e lo restituisce nella stessa forma wire
// (`InfinityAgendaDto`) prodotta dal mock: il mapper verso il dominio, la sync e le dashboard non
// cambiano. Non lancia mai: ogni guasto diventa un `ProviderError` con codice normalizzato e flag
// `retryable`, come per le altre porte.
//
// Sorgente del planning (`planningSource`): la procedura nativa `sp_off_docs_planning` (la stessa
// del planning di Infinity, vede anche cancellate e chiuse) oppure le tabelle (`tdo_pre`…); in
// `auto` si prova la procedura e, se l'utenza del DSN non ha il GRANT, si ripiega sulle tabelle
// avvisando una volta sola. Secondo ripiego, indipendente: se la vista `clienti` (o `anagrafica`
// sotto di lei) richiama funzioni non concesse, il planning si rilegge SENZA anagrafica (clienti
// "Cliente <id>", cellulare solo da `telefono`): l'officina non si ferma per un GRANT. `checkAccess`
// elenca oggetto per oggetto cosa l'utenza può leggere e quali GRANT chiedere: è ciò che
// `npm run infinity:check` stampa prima del passaggio a infinity01.
//
// Il database si sceglie con l'ambiente (`INFINITY_ODBC_DSN=Infinity02` → `Infinity01`): questa
// classe non conosce nessun indirizzo.
import { err, ok } from '@/domain/result';
import type { IsoDate } from '@/domain/value-objects/iso-date';
import type { InfinityAgendaDto, InfinityAppointmentDto } from '@/services/dto/infinity.dto';
import type { CallOptions, HealthStatus, ProviderResult } from '@/services/interfaces/common';
import { providerError } from '@/services/interfaces/common';
import type { IClock } from '@/services/interfaces/IClock';
import type { IInfinityService } from '@/services/interfaces/IInfinityService';
import type { ILogger } from '@/services/interfaces/ILogger';
import type { InfinityOdbcConfig } from './infinity-odbc-config';
import { describeConnection } from './infinity-odbc-config';
import {
  healthSql,
  linesSql,
  parseLineRows,
  parsePhoneRows,
  parseTempoRows,
  phonesSql,
  planningProcedureSql,
  planningTablesSql,
  sediSql,
  tempiSql,
  toAgendaDto,
  toPlanningRecords,
  type InfinityPlanningRecord,
} from './infinity-planning-query';
import type { IOdbcClient, OdbcParam, OdbcRow } from './OdbcClient';

export interface InfinityServiceOdbcDeps {
  readonly client: IOdbcClient;
  readonly clock: IClock;
  readonly logger: ILogger;
}

/** Sorgente effettivamente usata dall'ultima lettura del planning. */
export type InfinityPlanningSourceInUse = 'procedure' | 'tables';

/** Esito della verifica di accesso a un oggetto del database. */
export interface InfinityAccessCheck {
  readonly oggetto: string;
  readonly tipo: 'tabella' | 'vista' | 'procedura' | 'funzione';
  /** obbligatorio: senza non si legge il planning; consigliato: perde funzioni; facoltativo: informativo. */
  readonly livello: 'obbligatorio' | 'consigliato' | 'facoltativo';
  readonly scopo: string;
  readonly ok: boolean;
  readonly errore: string | null;
  /** Istruzione da chiedere all'IT del gestionale se `ok` è false. */
  readonly grant: string;
}

/** Classifica un errore del driver in un codice di provider e dice se ha senso ritentare. */
export function classifyOdbcError(error: unknown): {
  readonly code: 'TIMEOUT' | 'NETWORK' | 'AUTH' | 'INVALID_REQUEST' | 'PROVIDER_ERROR';
  readonly retryable: boolean;
  readonly message: string;
} {
  const message = messageOf(error);
  const upper = message.toUpperCase();
  // Stati SQL e testi tipici di SQL Anywhere / ODBC.
  if (upper.includes('TIMEOUT') || upper.includes('HYT00') || upper.includes('HYT01')) {
    return { code: 'TIMEOUT', retryable: true, message };
  }
  if (
    upper.includes('08001') ||
    upper.includes('08S01') ||
    upper.includes('08003') ||
    upper.includes('DATABASE SERVER NOT FOUND') ||
    upper.includes('CONNECTION WAS TERMINATED') ||
    upper.includes('COMMUNICATION LINK') ||
    upper.includes('DATA SOURCE NAME NOT FOUND') ||
    upper.includes('IM002')
  ) {
    return { code: 'NETWORK', retryable: true, message };
  }
  if (
    upper.includes('28000') ||
    upper.includes('INVALID USER ID OR PASSWORD') ||
    upper.includes('PERMISSION DENIED')
  ) {
    return { code: 'AUTH', retryable: false, message };
  }
  if (
    upper.includes('42S02') ||
    upper.includes('42S22') ||
    upper.includes('NOT FOUND') ||
    upper.includes('SYNTAX ERROR')
  ) {
    return { code: 'INVALID_REQUEST', retryable: false, message };
  }
  return { code: 'PROVIDER_ERROR', retryable: true, message };
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    // Il modulo `odbc` allega `odbcErrors: [{ state, code, message }]`.
    const odbcErrors = (error as Error & { odbcErrors?: readonly OdbcRow[] }).odbcErrors;
    if (Array.isArray(odbcErrors) && odbcErrors.length > 0) {
      return odbcErrors
        .map((e) => `[${String(e['state'] ?? '')}] ${String(e['message'] ?? '')}`.trim())
        .join(' | ');
    }
    return error.message;
  }
  return String(error);
}

/** Diniego di permesso di SQL Anywhere (tabella, vista o procedura). */
export function isPermissionDenied(error: unknown): boolean {
  return /permission denied|non hai il permesso|-121\b/i.test(messageOf(error));
}

/**
 * Nome della procedura o funzione che il diniego dice di non poter eseguire, se il messaggio la
 * nomina (es. `permission to execute the procedure "fn_getidutenticoll_doc"`); altrimenti null.
 */
export function deniedProcedureIn(message: string): string | null {
  const m = /execute the procedure\s+"([^"]+)"/i.exec(message);
  return m?.[1] ?? null;
}

export class InfinityServiceOdbc implements IInfinityService {
  readonly name = 'INFINITY' as const;

  private readonly log: ILogger;

  /** In `auto`, dopo un fallimento della procedura non si insiste a ogni sync: un avviso e basta. */
  private procedureUnavailable = false;

  private lastSource: InfinityPlanningSourceInUse | null = null;

  /** Vista clienti negata: si legge senza anagrafica finché il processo vive (avviso una volta sola). */
  private customerUnavailable = false;

  private sediCache: readonly string[] | null = null;

  constructor(
    private readonly config: InfinityOdbcConfig,
    private readonly deps: InfinityServiceOdbcDeps,
  ) {
    this.log = deps.logger.child('InfinityOdbc');
    this.log.info(`adapter pronto: ${describeConnection(config)}`);
  }

  /** Sorgente usata dall'ultima lettura (null prima della prima lettura). */
  get planningSourceInUse(): InfinityPlanningSourceInUse | null {
    return this.lastSource;
  }

  /** false quando il planning si legge senza la vista clienti (GRANT mancanti): nomi e telefoni parziali. */
  get customerDataAvailable(): boolean {
    return !this.customerUnavailable;
  }

  async fetchDailyAgenda(
    businessDate: IsoDate,
    options?: CallOptions,
  ): Promise<ProviderResult<InfinityAgendaDto>> {
    const startedAt = this.deps.clock.now().getTime();
    try {
      const records = await this.fetchPlanningRecords(businessDate);
      const agenda = toAgendaDto(
        records,
        businessDate,
        this.config.timeZone,
        this.deps.clock.nowIso(),
      );
      this.log.info('agenda letta da Infinity', {
        businessDate,
        sorgente: this.lastSource,
        anagrafica: this.customerUnavailable ? 'non leggibile' : 'ok',
        appuntamenti: agenda.appointments.length,
        annullati: records.filter((r) => r.annullata).length,
        senzaTarga: records.filter((r) => r.targa === null).length,
        senzaNome: records.filter((r) => r.cliente === null).length,
        durataMs: this.deps.clock.now().getTime() - startedAt,
        correlationId: options?.correlationId ?? null,
      });
      return ok(agenda);
    } catch (error) {
      return err(this.toProviderError(error, `lettura planning del ${businessDate}`));
    }
  }

  async fetchAppointmentByPlate(
    plate: string,
    businessDate: IsoDate,
  ): Promise<ProviderResult<InfinityAppointmentDto | null>> {
    const normalizzata = plate.replace(/\s+/g, '').toUpperCase();
    if (normalizzata === '') {
      return err(providerError('INFINITY', 'INVALID_REQUEST', 'Targa vuota.', false));
    }
    try {
      const records = await this.fetchPlanningRecords(businessDate, normalizzata);
      const agenda = toAgendaDto(
        records,
        businessDate,
        this.config.timeZone,
        this.deps.clock.nowIso(),
      );
      return ok(agenda.appointments[0] ?? null);
    } catch (error) {
      return err(this.toProviderError(error, `ricerca targa ${normalizzata} del ${businessDate}`));
    }
  }

  async healthCheck(): Promise<HealthStatus> {
    const startedAt = this.deps.clock.now().getTime();
    try {
      const rows = await this.deps.client.query(healthSql());
      const riga = rows[0] ?? {};
      const latencyMs = Math.max(0, this.deps.clock.now().getTime() - startedAt);
      const sorgente =
        this.lastSource ??
        (this.config.planningSource === 'auto' ? 'auto' : this.config.planningSource);
      return {
        provider: 'INFINITY',
        status: 'UP',
        checkedAt: this.deps.clock.nowIso(),
        latencyMs,
        detail: `${this.config.dbType} · DSN ${this.config.dsn} · db ${String(riga['db'] ?? '?')} · versione ${String(riga['versione'] ?? '?')} · utente ${String(riga['utente'] ?? '?')} · planning ${sorgente}${this.customerUnavailable ? ' · anagrafica non leggibile' : ''}`,
        implementation: 'real',
      };
    } catch (error) {
      const classified = classifyOdbcError(error);
      return {
        provider: 'INFINITY',
        status: 'DOWN',
        checkedAt: this.deps.clock.nowIso(),
        latencyMs: null,
        detail: `${classified.code}: ${classified.message}`,
        implementation: 'real',
      };
    }
  }

  /**
   * Planning completo della giornata (lavorazioni, tempi, telefoni, nomi).
   * È il metodo usato anche dalla verifica a terminale: restituisce i record leggibili, non il DTO.
   * Lancia in caso di errore: i metodi della porta lo trasformano in `ProviderError`.
   */
  async fetchPlanningRecords(
    businessDate: IsoDate,
    plate: string | null = null,
  ): Promise<readonly InfinityPlanningRecord[]> {
    const schema = this.config.schema;
    const rows = await this.fetchPlanningRows(businessDate, plate);
    if (rows.length === 0) {
      return [];
    }

    const idDocumenti = unique(rows.map((r) => Number(r['id_documento'])));
    const idClienti = unique(rows.map((r) => Number(r['id_cliente'])));

    const [lineRows, tempoRows, phoneRows] = await Promise.all([
      idDocumenti.length > 0
        ? this.deps.client.query(linesSql(schema, idDocumenti.length), idDocumenti)
        : Promise.resolve([] as readonly OdbcRow[]),
      idDocumenti.length > 0
        ? this.deps.client.query(tempiSql(schema, idDocumenti.length), idDocumenti)
        : Promise.resolve([] as readonly OdbcRow[]),
      this.deps.client.query(phonesSql(schema, idClienti.length), idClienti),
    ]);

    return toPlanningRecords({
      rows,
      lines: parseLineRows(lineRows),
      tempi: parseTempoRows(tempoRows),
      phones: parsePhoneRows(phoneRows),
      businessDate,
      includeWorkOrders: this.config.includeWorkOrders,
    });
  }

  /**
   * Verifica, oggetto per oggetto, cosa l'utenza del DSN può leggere ed eseguire. Sola lettura:
   * ogni prova è una SELECT minima. Serve prima del passaggio a un nuovo database (infinity01).
   */
  async checkAccess(businessDate: IsoDate): Promise<readonly InfinityAccessCheck[]> {
    const s = this.config.schema;
    const sede = this.config.sede ?? (await this.resolveSedi().catch(() => ['01']))[0] ?? '01';
    const utente = '<utente_dsn>';
    const sel = (t: string, col: string): string => `SELECT TOP 1 ${col} FROM ${s}.${t}`;
    const tab = (
      oggetto: string,
      col: string,
      scopo: string,
      livello: InfinityAccessCheck['livello'] = 'obbligatorio',
      tipo: InfinityAccessCheck['tipo'] = 'tabella',
    ) => ({
      oggetto,
      tipo,
      livello,
      scopo,
      sql: sel(oggetto, col),
      params: [] as OdbcParam[],
      grant: `GRANT SELECT ON ${s}.${oggetto} TO ${utente};`,
    });
    const prove = [
      tab('tdo_pre', 'id_documento', 'testata delle prenotazioni'),
      tab('tipi_doc', 'codice', 'tipo documento e sede'),
      tab('o_operai', 'matricola', "nome dell'accettatore"),
      tab('off_veicoli', 'id_veicolo', 'targa, telaio, marca, modello'),
      tab('off_invii_fal', 'id', 'targa dalla prenotazione (ripiego)'),
      tab('off_marche', 'cod_marca', 'descrizione marca'),
      tab('off_modelli', 'cod_modello', 'descrizione modello', 'consigliato'),
      tab(
        'clienti',
        'codice_cliente',
        'ragione sociale, cognome/nome, telefoni (senza: clienti come "Cliente <id>")',
        'consigliato',
        'vista',
      ),
      tab('contatti', 'codice_contatto', 'referente della prenotazione', 'facoltativo'),
      tab('mdm_pre_inc', 'id_ordine', 'lavorazioni richieste (righe)', 'consigliato'),
      tab(
        'vs_off_inc_tipoinc',
        'id_documento',
        'tempi per tipo di incarico',
        'consigliato',
        'vista',
      ),
      tab('telefono', 'id_telefono', 'cellulare per le notifiche', 'consigliato'),
      tab('off_tipi_intervento', 'codice', 'descrizione tipo intervento', 'facoltativo'),
      tab('off_stati_doc', 'id', 'stato documento (Annullata, Chiusa in ODL…)', 'consigliato'),
      tab('default_generali', 'codice', 'cliente generico della sede', 'facoltativo'),
      {
        oggetto: 'sp_off_docs_planning',
        tipo: 'procedura' as const,
        livello: 'consigliato' as const,
        scopo: 'planning nativo di Infinity: vede anche prenotazioni cancellate, chiuse e commesse',
        sql: `SELECT COUNT(*) AS n FROM ${s}.sp_off_docs_planning(?, ?, 'T', NULL, 0, 0) tab`,
        params: [businessDate, sede] as OdbcParam[],
        grant: `GRANT EXECUTE ON ${s}.sp_off_docs_planning TO ${utente};`,
      },
      {
        oggetto: 'fn_off_doc_vei_cortesia',
        tipo: 'funzione' as const,
        livello: 'facoltativo' as const,
        scopo: "veicolo di cortesia della prenotazione (non usato dall'app)",
        sql: `SELECT ${s}.fn_off_doc_vei_cortesia('Z', 0, NULL) AS v`,
        params: [] as OdbcParam[],
        grant: `GRANT EXECUTE ON ${s}.fn_off_doc_vei_cortesia TO ${utente};`,
      },
      {
        oggetto: 'anagrafica',
        tipo: 'tabella' as const,
        livello: 'consigliato' as const,
        scopo:
          'tabella sotto la vista clienti: la colonna calcolata ipp_search richiede fn_rimuovi_doppi_spazi, che serve quindi anche per leggere clienti',
        sql: sel('anagrafica', 'id_anagrafica'),
        params: [] as OdbcParam[],
        grant: `GRANT EXECUTE ON ${s}.fn_rimuovi_doppi_spazi TO ${utente};`,
      },
    ];
    const esiti: InfinityAccessCheck[] = [];
    for (const prova of prove) {
      try {
        await this.deps.client.query(prova.sql, prova.params);
        esiti.push({ ...senzaSql(prova), ok: true, errore: null });
      } catch (error) {
        const errore = messageOf(error);
        // Se il diniego nomina una procedura (colonna calcolata o vista che la richiama), il GRANT
        // giusto è l'EXECUTE su quella, non la SELECT sulla tabella: il messaggio lo dice.
        const funzione = deniedProcedureIn(errore);
        esiti.push({
          ...senzaSql(prova),
          ok: false,
          errore,
          grant:
            funzione === null || funzione.toLowerCase() === prova.oggetto.toLowerCase()
              ? prova.grant
              : `GRANT EXECUTE ON ${s}.${funzione} TO ${utente};  -- richiamata leggendo ${prova.oggetto}`,
        });
      }
    }
    return esiti;
  }

  /**
   * Righe di testata del planning, con due ripieghi indipendenti e un solo avviso ciascuno:
   * procedura → tabelle (GRANT sulla procedura mancante, solo in `auto`) e con → senza anagrafica
   * (vista clienti negata). Entrambi restano attivi per la vita del processo: un GRANT nuovo vale
   * dal riavvio.
   */
  private async fetchPlanningRows(
    businessDate: IsoDate,
    plate: string | null,
  ): Promise<readonly OdbcRow[]> {
    const source = this.config.planningSource;
    if (source !== 'tables' && !this.procedureUnavailable) {
      try {
        const rows = await this.rowsWithCustomerFallback(businessDate, plate, 'procedure');
        this.lastSource = 'procedure';
        return rows;
      } catch (error) {
        if (source === 'procedure') {
          throw error;
        }
        this.procedureUnavailable = true;
        this.log.warn(
          `procedura ${this.config.schema}.sp_off_docs_planning non utilizzabile: si legge il planning dalle tabelle (prenotazioni cancellate in Infinity non visibili). ` +
            `Richiedere: GRANT EXECUTE ON ${this.config.schema}.sp_off_docs_planning TO <utente DSN>.`,
          { dettaglio: messageOf(error), permessoNegato: isPermissionDenied(error) },
        );
      }
    }
    const rows = await this.rowsWithCustomerFallback(businessDate, plate, 'tables');
    this.lastSource = 'tables';
    return rows;
  }

  /**
   * Legge la sorgente indicata con il join sull'anagrafica; se il database nega una funzione
   * richiamata da quel join (vista clienti, colonna calcolata di anagrafica) riprova senza e da lì
   * in avanti legge sempre così. Un diniego sulla procedura stessa o sulla testata non c'entra con
   * l'anagrafica: il secondo tentativo fallisce e vale l'errore originale.
   */
  private async rowsWithCustomerFallback(
    businessDate: IsoDate,
    plate: string | null,
    source: InfinityPlanningSourceInUse,
  ): Promise<readonly OdbcRow[]> {
    const leggi = (withCustomer: boolean): Promise<readonly OdbcRow[]> =>
      source === 'procedure'
        ? this.rowsFromProcedure(businessDate, plate, withCustomer)
        : this.rowsFromTables(businessDate, plate, withCustomer);
    if (this.customerUnavailable) {
      return leggi(false);
    }
    try {
      return await leggi(true);
    } catch (error) {
      const funzione = deniedProcedureIn(messageOf(error));
      if (!isPermissionDenied(error) || funzione?.toLowerCase() === 'sp_off_docs_planning') {
        throw error;
      }
      let rows: readonly OdbcRow[];
      try {
        rows = await leggi(false);
      } catch {
        throw error;
      }
      this.customerUnavailable = true;
      this.log.warn(
        `anagrafica clienti non leggibile (${funzione === null ? 'vista clienti negata' : `funzione ${funzione} negata`}): planning letto senza nomi, i clienti compaiono come "Cliente <id>" e il cellulare arriva solo dalla tabella telefono. ` +
          `Richiedere l'EXECUTE sulle funzioni della vista clienti (npm run infinity:check elenca i GRANT).`,
        { dettaglio: messageOf(error), sorgente: source },
      );
      return rows;
    }
  }

  private async rowsFromProcedure(
    businessDate: IsoDate,
    plate: string | null,
    withCustomer: boolean,
  ): Promise<readonly OdbcRow[]> {
    const sedi = this.config.sede === null ? await this.resolveSedi() : [this.config.sede];
    const docTypes = this.config.bookingDocTypes;
    const sql = planningProcedureSql(this.config.schema, docTypes.length, plate !== null, {
      withCustomer,
      includeWorkOrders: this.config.includeWorkOrders,
    });
    const risultati: OdbcRow[] = [];
    for (const sede of sedi) {
      const params: OdbcParam[] = [businessDate, sede, ...docTypes];
      if (plate !== null) {
        params.push(plate);
      }
      risultati.push(...(await this.deps.client.query(sql, params)));
    }
    return risultati;
  }

  private async rowsFromTables(
    businessDate: IsoDate,
    plate: string | null,
    withCustomer: boolean,
  ): Promise<readonly OdbcRow[]> {
    const docTypes = this.config.bookingDocTypes;
    const params: OdbcParam[] = [businessDate, ...docTypes];
    if (plate !== null) {
      params.push(plate);
    }
    return this.deps.client.query(
      planningTablesSql(this.config.schema, docTypes.length, plate !== null, { withCustomer }),
      params,
    );
  }

  /** Sedi dei tipi documento configurati (parametro della procedura), lette una volta sola. */
  private async resolveSedi(): Promise<readonly string[]> {
    if (this.sediCache !== null) {
      return this.sediCache;
    }
    const docTypes = this.config.bookingDocTypes;
    const rows = await this.deps.client.query(sediSql(this.config.schema, docTypes.length), [
      ...docTypes,
    ]);
    const sedi = unique(rows.map((r) => String(r['sede'] ?? '').trim()).filter((s) => s !== ''));
    if (sedi.length === 0) {
      throw new Error(
        `Nessuna sede (tipi_doc.sede_cont) per i tipi documento ${docTypes.join(', ')}: impostare INFINITY_SEDE.`,
      );
    }
    this.sediCache = sedi;
    return sedi;
  }

  private toProviderError(error: unknown, operazione: string) {
    const classified = classifyOdbcError(error);
    this.log.error(`${operazione} fallita`, {
      code: classified.code,
      dettaglio: classified.message,
    });
    return providerError(
      'INFINITY',
      classified.code,
      `Infinity (${this.config.dsn}): ${operazione} fallita: ${classified.message}`,
      classified.retryable,
      error,
    );
  }
}

function senzaSql<T extends { sql: string; params: readonly OdbcParam[] }>(
  prova: T,
): Omit<T, 'sql' | 'params'> {
  const { sql: _sql, params: _params, ...resto } = prova;
  return resto;
}

function unique<T extends string | number>(values: readonly T[]): T[] {
  return [
    ...new Set(values.filter((v) => (typeof v === 'number' ? Number.isFinite(v) : v !== ''))),
  ];
}
