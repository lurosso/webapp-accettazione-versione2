import { describe, expect, it } from 'vitest';
import type { IsoDate } from '@/domain/value-objects/iso-date';
import { NoopLogger } from '@/services/mocks/ConsoleLogger';
import {
  InfinityServiceOdbc,
  SqlAnywhereOdbcClient,
  brandCodeFromDescription,
  buildConnectionString,
  classifyOdbcError,
  deniedProcedureIn,
  customerNameOf,
  describeConnection,
  parseLineRows,
  parsePhoneRows,
  parseTempoRows,
  planningProcedureSql,
  planningTablesSql,
  toAgendaDto,
  toPlanningRecords,
  type IOdbcClient,
  type InfinityOdbcConfig,
  type OdbcModuleLike,
  type OdbcParam,
  type OdbcRow,
} from '@/infrastructure/adapters/infinity';
import { TestClock } from '../helpers/fixtures';

const GIORNATA = '2023-12-28' as IsoDate;

const CONFIG: InfinityOdbcConfig = {
  dsn: 'Infinity02',
  dbType: 'sql_anywhere_12',
  uid: null,
  pwd: null,
  extra: null,
  schema: 'DBA',
  bookingDocTypes: ['PR01'],
  planningSource: 'auto',
  sede: null,
  timeZone: 'Europe/Rome',
  loginTimeoutSec: 5,
  queryTimeoutSec: 30,
};

/** Righe come le restituiscono le due sorgenti (stesse colonne), valori reali anonimizzati. */
const RIGHE_PLANNING: readonly OdbcRow[] = [
  {
    genere_doc: 'Z',
    id_documento: 41001,
    id_commessa: null,
    tipo_riga: 'P',
    data_prenotazione: new Date('2023-12-28T00:00:00.000Z'),
    ora_prenotazione: '08:30:00',
    data_prevcons: null,
    ora_prevcons: null,
    anno: 2023,
    tipo_doc: 'PR01',
    tipo_doc_descr: 'Prenotazione/Preventivo officina Bari',
    sede: '01',
    id_cliente_generico: null,
    num_doc: 7,
    data_doc: new Date('2023-12-20T00:00:00.000Z'),
    id_cliente: 5001,
    cliente: 'ROSSI MARIO',
    cliente_cognome: 'ROSSI',
    cliente_nome: 'MARIO',
    cons_privacy: 'S',
    pref_invio_notifiche: 'S',
    indirizzo_notifiche: '3337777777',
    tel_cliente1: '080 1234567',
    tel_cliente2: null,
    tel_cliente3: null,
    codice_contatto: null,
    contatto: null,
    contatto_cellulare: null,
    accettatore_cod: '102',
    accettatore_nome: 'GIORGIO VERDI',
    tipo_intervento: '2',
    tipo_intervento_descr: 'Postvendita',
    confermato: 1,
    flag_clienteinsala: 0,
    id_stato_doc: null,
    order_id: null,
    note_doc: 'Tagliando 30.000 km',
    note_cliente: null,
    proprietario: null,
    closed: 0,
    deleted: 0,
    pren_closed: 0,
    ordine_lavoro: 'Z6663/2023',
    data_modifica: '2023-12-27 17:45:10.000',
    data_creazione: '2023-12-20 09:00:00.000',
    id_veicolo: 9001,
    targa: 'ab 123 cd',
    telaio: 'ZFA00000000000001',
    cod_marca: '00',
    marca_descr: 'FIAT',
    cod_modello: '33433A0',
    modello_descr: '500X 1.3 MJET',
    modello_comm: null,
  },
  {
    genere_doc: 'Z',
    id_documento: 41002,
    id_commessa: null,
    tipo_riga: 'P',
    data_prenotazione: '2023-12-28',
    ora_prenotazione: '9:15',
    data_prevcons: null,
    ora_prevcons: null,
    anno: 2023,
    tipo_doc: 'PR01',
    tipo_doc_descr: 'Prenotazione/Preventivo officina Bari',
    sede: '01',
    id_cliente_generico: null,
    num_doc: 8,
    data_doc: '2023-12-21',
    id_cliente: 5002,
    cliente: 'UNIPOLRENTAL SPA',
    cliente_cognome: null,
    cliente_nome: null,
    cons_privacy: null,
    pref_invio_notifiche: 'E',
    indirizzo_notifiche: 'flotte@esempio.it',
    tel_cliente1: null,
    tel_cliente2: '333 444 5566',
    tel_cliente3: null,
    codice_contatto: 77,
    contatto: 'NATILLA MASSIMO',
    contatto_cellulare: '3339998877',
    accettatore_cod: null,
    accettatore_nome: null,
    tipo_intervento: null,
    tipo_intervento_descr: null,
    confermato: 0,
    flag_clienteinsala: 1,
    id_stato_doc: null,
    order_id: null,
    note_doc: null,
    note_cliente: 'Rumore anteriore  sinistro',
    proprietario: null,
    closed: 0,
    deleted: 0,
    pren_closed: 0,
    ordine_lavoro: null,
    data_modifica: null,
    data_creazione: null,
    id_veicolo: null,
    targa: null,
    telaio: null,
    cod_marca: '83',
    marca_descr: 'Alfa Romeo',
    cod_modello: null,
    modello_descr: null,
    modello_comm: null,
  },
];

/** Riga "cancellata" come la restituisce solo la procedura. */
const RIGA_CANCELLATA: OdbcRow = {
  ...RIGHE_PLANNING[0]!,
  id_documento: 41003,
  num_doc: 9,
  id_cliente: 5003,
  cliente: 'BIANCHI ANNA',
  cliente_cognome: 'BIANCHI',
  cliente_nome: 'ANNA',
  targa: 'CD456EF',
  deleted: 1,
};

/** Riga letta dalle tabelle (deleted sempre 0) ma con stato documento "Annullata" (id 4). */
const RIGA_STATO_ANNULLATA: OdbcRow = {
  ...RIGHE_PLANNING[0]!,
  id_documento: 41004,
  num_doc: 10,
  deleted: 0,
  id_stato_doc: 4,
  stato_doc_descr: 'Annullata',
};

/** Stessa prenotazione riproposta come commessa (genere L): la procedura può restituirle entrambe. */
const RIGA_COMMESSA: OdbcRow = {
  ...RIGHE_PLANNING[0]!,
  genere_doc: 'L',
  id_commessa: 90001,
  closed: 0,
};

const RIGHE_LAVORAZIONI: readonly OdbcRow[] = [
  {
    id_documento: 41001,
    id_riga: 1,
    tipo_riga: 'E',
    inconveniente: null,
    descr_inconveniente: 'TAGLIANDO DI MANUTENZIONE',
    tempo_stimato: 2,
  },
  {
    id_documento: 41001,
    id_riga: 2,
    tipo_riga: 'E',
    inconveniente: '6338',
    descr_inconveniente: '6338 - SW RADIO',
    tempo_stimato: '0,5',
  },
];

const RIGHE_TEMPI: readonly OdbcRow[] = [
  { id_documento: 41001, codice: 'T', descrizione: 'Tagliando', ore: 2, numero: 1 },
  { id_documento: 41001, codice: 'G', descrizione: 'Generico', ore: 0.5, numero: 1 },
];

const RIGHE_TELEFONI: readonly OdbcRow[] = [
  { id_anagrafica: 5001, num_riferimento: '3331111111', usa_per_notifiche: 'N' },
  { id_anagrafica: 5001, num_riferimento: '3332222222', usa_per_notifiche: 'S' },
];

interface FakeOptions {
  /** Errore lanciato dalla procedura (es. permesso negato). */
  readonly procedureError?: Error;
  /** Errore lanciato dalla lettura delle tabelle. */
  readonly tablesError?: Error;
  /** Errore lanciato da entrambe le sorgenti quando la SQL include il join sulla vista clienti. */
  readonly customerError?: Error;
  readonly procedureRows?: readonly OdbcRow[];
  readonly tableRows?: readonly OdbcRow[];
}

/** Colonne che il database restituisce a NULL quando la SQL non fa il join sull'anagrafica. */
const COLONNE_ANAGRAFICA = [
  'cliente',
  'cliente_cognome',
  'cliente_nome',
  'cons_privacy',
  'pref_invio_notifiche',
  'indirizzo_notifiche',
  'tel_cliente1',
  'tel_cliente2',
  'tel_cliente3',
  'contatto',
  'contatto_cellulare',
] as const;

/** Client finto: risponde in base al testo della query e registra le chiamate. */
class FakeOdbcClient implements IOdbcClient {
  readonly calls: { sql: string; params: readonly OdbcParam[] }[] = [];

  constructor(private readonly options: FakeOptions = {}) {}

  /** Righe di testata: come il database, con o senza il join sull'anagrafica. */
  private planning(
    sql: string,
    params: readonly OdbcParam[],
    righe: readonly OdbcRow[] | undefined,
    errore: Error | undefined,
  ): readonly OdbcRow[] {
    if (errore !== undefined) {
      throw errore;
    }
    const filtrate = filtraTarga(righe ?? RIGHE_PLANNING, sql, params);
    if (sql.includes('DBA.clienti')) {
      if (this.options.customerError !== undefined) {
        throw this.options.customerError;
      }
      return filtrate;
    }
    return filtrate.map((r) => ({
      ...r,
      ...Object.fromEntries(COLONNE_ANAGRAFICA.map((c) => [c, null])),
    }));
  }

  async query(sql: string, params: readonly OdbcParam[] = []): Promise<readonly OdbcRow[]> {
    this.calls.push({ sql, params });
    if (sql.includes('sp_off_docs_planning(')) {
      return this.planning(sql, params, this.options.procedureRows, this.options.procedureError);
    }
    if (sql.includes('FROM DBA.tdo_pre p')) {
      return this.planning(sql, params, this.options.tableRows, this.options.tablesError);
    }
    if (sql.includes('FROM DBA.tipi_doc td')) {
      return [{ sede: '01' }];
    }
    if (sql.includes('.mdm_pre_inc ')) {
      return RIGHE_LAVORAZIONI;
    }
    if (sql.includes('.vs_off_inc_tipoinc ')) {
      return RIGHE_TEMPI;
    }
    if (sql.includes('.telefono ')) {
      return RIGHE_TELEFONI;
    }
    if (sql.includes("PROPERTY('ProductVersion')")) {
      return [{ versione: '12.0.1.4436', db: 'infinity02', utente: 'utente_prova' }];
    }
    return [];
  }
}

function filtraTarga(
  righe: readonly OdbcRow[],
  sql: string,
  params: readonly OdbcParam[],
): readonly OdbcRow[] {
  if (!sql.includes('REPLACE(') || !sql.includes('= ?\nORDER')) {
    return righe;
  }
  const targa = params[params.length - 1];
  return righe.filter(
    (r) =>
      String(r['targa'] ?? '')
        .replace(/\s+/g, '')
        .toUpperCase() === targa,
  );
}

function permessoNegato(oggetto: string): Error {
  return new Error(
    `[42000] [Sybase][ODBC Driver][SQL Anywhere]Permission denied: you do not have permission to execute the procedure "${oggetto}"`,
  );
}

function build(client: IOdbcClient, config: InfinityOdbcConfig = CONFIG) {
  const clock = new TestClock('2023-12-28T06:00:00.000Z');
  return new InfinityServiceOdbc(config, { client, clock, logger: new NoopLogger() });
}

describe('Infinity ODBC: configurazione', () => {
  it('la stringa di connessione porta il DSN e il CharSet UTF-8 quando le credenziali stanno nel DSN', () => {
    // CharSet=UTF-8 fa convertire al driver le stringhe windows-1252 del database: senza, le
    // lettere accentate arrivano al modulo odbc come U+FFFD.
    expect(buildConnectionString(CONFIG)).toBe('DSN=Infinity02;CharSet=UTF-8');
  });

  it('con utente e password li aggiunge, con le graffe se contengono caratteri speciali', () => {
    const s = buildConnectionString({ ...CONFIG, uid: 'app', pwd: 'p;w}d' });
    expect(s).toBe('DSN=Infinity02;UID=app;PWD={p;w}}d};CharSet=UTF-8');
  });

  it('un CharSet indicato negli attributi aggiuntivi non viene raddoppiato', () => {
    expect(buildConnectionString({ ...CONFIG, extra: 'Host=x:2638;CharSet=cp1252' })).toBe(
      'DSN=Infinity02;Host=x:2638;CharSet=cp1252',
    );
  });

  it('la descrizione per i log non contiene mai la password', () => {
    const d = describeConnection({ ...CONFIG, uid: 'app', pwd: 'segretissima', sede: '01' });
    expect(d).toContain('utente app');
    expect(d).toContain('password impostata');
    expect(d).toContain('planning auto, sede 01');
    expect(d).not.toContain('segretissima');
  });

  it('le due SQL del planning usano lo schema configurato, i segnaposto e solo SELECT', () => {
    const proc = planningProcedureSql('DBA', 2, true);
    expect(proc).toContain("FROM DBA.sp_off_docs_planning(?, ?, 'T', NULL, 0, 0) tab");
    expect(proc).toContain('WHERE COALESCE(p.tipo_doc, tab.tipo_doc) IN (?, ?)');
    expect(proc).toContain("UPPER(REPLACE(tab.targa, ' ', '')) = ?");
    expect(proc).toContain('LEFT JOIN DBA.clienti c ON c.codice_cliente = tab.id_cliente');
    const tabelle = planningTablesSql('DBA', 1);
    expect(tabelle).toContain('FROM DBA.tdo_pre p');
    expect(tabelle).toContain('p.tipo_doc IN (?)');
    expect(tabelle).toContain('LEFT JOIN DBA.off_modelli mo');
    for (const sql of [
      proc,
      tabelle,
      planningProcedureSql('DBA', 1),
      planningTablesSql('DBA', 3, true),
      planningProcedureSql('DBA', 1, false, { withCustomer: false }),
      planningTablesSql('DBA', 2, true, { withCustomer: false }),
    ]) {
      expect(sql).not.toMatch(/\b(insert|update|delete|drop|alter)\b/i);
      expect(sql.startsWith('SELECT')).toBe(true);
      // Ogni riga dell'elenco colonne, tranne l'ultima, deve chiudersi con la virgola: una virgola
      // mancante fra i blocchi comuni e quelli specifici è un errore di sintassi solo sul database.
      const elenco = sql.slice('SELECT'.length, sql.indexOf('\nFROM ')).trim().split('\n');
      for (const riga of elenco.slice(0, -1)) {
        expect(riga.trim().endsWith(',')).toBe(true);
      }
      expect(elenco.at(-1)?.trim().endsWith(',')).toBe(false);
    }
  });

  it('senza anagrafica le SQL non toccano clienti/contatti ma restituiscono le stesse colonne, a NULL', () => {
    for (const sql of [
      planningProcedureSql('DBA', 1, false, { withCustomer: false }),
      planningTablesSql('DBA', 1, true, { withCustomer: false }),
    ]) {
      expect(sql).not.toContain('DBA.clienti');
      expect(sql).not.toContain('DBA.contatti');
      expect(sql).toContain('CAST(NULL AS VARCHAR(80)) AS cliente,');
      expect(sql).toContain('AS indirizzo_notifiche,');
      expect(sql).toContain('AS contatto_cellulare,');
      expect(sql).toContain('.codice_contatto,');
    }
    expect(planningProcedureSql('DBA', 1)).toContain('LEFT JOIN DBA.contatti ct');
  });

  it('la procedura filtra sul tipo documento della PRENOTAZIONE: già in commessa, resta in agenda', () => {
    // Sui dati veri la procedura riporta LO01 (commessa) per una PR01 già accettata: senza il
    // COALESCE su tdo_pre la pratica sparirebbe e la sync la annullerebbe.
    const sql = planningProcedureSql('DBA', 1);
    expect(sql).toContain('WHERE COALESCE(p.tipo_doc, tab.tipo_doc) IN (?)');
    expect(sql).not.toContain("tab.genere_doc = 'L'");
    // Anche tipo, numero, anno e data in uscita sono quelli della prenotazione, e tipi_doc si
    // aggancia su quello: la pratica resta "PR01 5721/2026" come sul planning di Infinity.
    expect(sql).toContain('COALESCE(p.tipo_doc, tab.tipo_doc) AS tipo_doc');
    expect(sql).toContain('COALESCE(p.num_doc, tab.num_doc) AS num_doc');
    expect(sql).toContain('COALESCE(p.anno, tab.anno) AS anno');
    expect(sql).toContain('JOIN DBA.tipi_doc td ON td.codice = COALESCE(p.tipo_doc, tab.tipo_doc)');
    expect(sql.indexOf('LEFT JOIN DBA.tdo_pre p')).toBeLessThan(
      sql.indexOf('JOIN DBA.tipi_doc td'),
    );
    expect(planningTablesSql('DBA', 1)).toContain('p.tipo_doc AS tipo_doc, td.descrizione');
    expect(planningProcedureSql('DBA', 2, false)).toContain(
      'WHERE COALESCE(p.tipo_doc, tab.tipo_doc) IN (?, ?)',
    );
  });
});

describe('Infinity ODBC: mappatura del planning', () => {
  function records(rows: readonly OdbcRow[] = RIGHE_PLANNING) {
    return toPlanningRecords({
      rows,
      lines: parseLineRows(RIGHE_LAVORAZIONI),
      tempi: parseTempoRows(RIGHE_TEMPI),
      phones: parsePhoneRows(RIGHE_TELEFONI),
      businessDate: GIORNATA,
    });
  }

  it('trasforma le righe grezze in record leggibili con lavorazioni, tempi, telefono e nome', () => {
    const [primo, secondo] = records();
    expect(primo?.genereDoc).toBe('Z');
    expect(primo?.targa).toBe('AB123CD');
    expect(primo?.oraPrenotazione).toBe('08:30');
    expect(primo?.dataPrenotazione).toBe(GIORNATA);
    expect(primo?.sede).toBe('01');
    expect(primo?.accettatoreNome).toBe('GIORGIO VERDI');
    expect(primo?.cliente).toBe('ROSSI MARIO');
    expect(primo?.clienteCognome).toBe('ROSSI');
    expect(primo?.consensoPrivacy).toBe(true);
    expect(primo?.lavorazioni).toEqual(['TAGLIANDO DI MANUTENZIONE', '6338 - SW RADIO']);
    expect(primo?.tempi).toEqual([
      { codice: 'T', descrizione: 'Tagliando', ore: 2, numero: 1 },
      { codice: 'G', descrizione: 'Generico', ore: 0.5, numero: 1 },
    ]);
    expect(primo?.tempoStimatoOre).toBe(2.5);
    expect(primo?.telefono).toBe('3332222222'); // tabella telefono, usa_per_notifiche = S
    expect(primo?.confermato).toBe(true);
    expect(primo?.annullata).toBe(false);
    expect(primo?.chiusa).toBe(false);
    expect(primo?.tipoInterventoDescrizione).toBe('Postvendita');
    expect(primo?.modelloDescrizione).toBe('500X 1.3 MJET');
    expect(primo?.ordineLavoro).toBe('Z6663/2023');
    expect(primo?.dataModifica).toBe(new Date('2023-12-27T17:45:10.000').toISOString());

    expect(secondo?.targa).toBeNull();
    expect(secondo?.oraPrenotazione).toBe('09:15');
    expect(secondo?.cliente).toBe('UNIPOLRENTAL SPA');
    expect(secondo?.contatto).toBe('NATILLA MASSIMO');
    expect(secondo?.lavorazioni).toEqual([]);
    expect(secondo?.tempoStimatoOre).toBeNull();
    // Nessun cellulare in `telefono`: si ripiega sul telefono in anagrafica che sembra un cellulare.
    expect(secondo?.telefono).toBe('3334445566');
    expect(secondo?.clienteInSala).toBe(true);
  });

  it("sceglie il cellulare nell'ordine: notifiche in telefono, recapito notifiche in anagrafica, altri", () => {
    const base = RIGHE_PLANNING[0]!;
    const senzaTelefonoNotifiche = toPlanningRecords({
      rows: [base],
      lines: [],
      tempi: [],
      phones: parsePhoneRows([
        { id_anagrafica: 5001, num_riferimento: '3331111111', usa_per_notifiche: 'N' },
      ]),
      businessDate: GIORNATA,
    });
    // Nessun numero marcato per le notifiche in `telefono`: vince il recapito notifiche dell'anagrafica.
    expect(senzaTelefonoNotifiche[0]?.telefono).toBe('3337777777');

    const soloAnagrafica = toPlanningRecords({
      rows: [{ ...base, indirizzo_notifiche: '+39 333 888 9999', pref_invio_notifiche: 'S' }],
      lines: [],
      tempi: [],
      phones: [],
      businessDate: GIORNATA,
    });
    expect(soloAnagrafica[0]?.telefono).toBe('+393338889999');

    const emailNotifiche = toPlanningRecords({
      rows: [
        {
          ...base,
          indirizzo_notifiche: 'mario@esempio.it',
          pref_invio_notifiche: 'E',
          tel_cliente1: '333 000 1111',
        },
      ],
      lines: [],
      tempi: [],
      phones: [],
      businessDate: GIORNATA,
    });
    expect(emailNotifiche[0]?.telefono).toBe('3330001111');
  });

  it('arrotonda le ore stimate a due decimali (somme di decimali binari)', () => {
    const [r] = toPlanningRecords({
      rows: [RIGHE_PLANNING[0]!],
      lines: [],
      tempi: parseTempoRows([
        { id_documento: 41001, codice: 'A', descrizione: 'A', ore: 0.1, numero: 1 },
        { id_documento: 41001, codice: 'B', descrizione: 'B', ore: 0.2, numero: 1 },
      ]),
      phones: [],
      businessDate: GIORNATA,
    });
    expect(r?.tempoStimatoOre).toBe(0.3);
  });

  it('il cliente generico della sede prende il nome dalle note cliente', () => {
    const riga: OdbcRow = {
      ...RIGHE_PLANNING[1]!,
      id_cliente: 999,
      id_cliente_generico: 999,
      cliente: 'CLIENTE GENERICO OFFICINA',
      note_cliente: 'Verdi Luigi (passante)',
    };
    const [r] = records([riga]);
    expect(r?.clienteGenerico).toBe(true);
    expect(r?.cliente).toBe('Verdi Luigi (passante)');
    expect(customerNameOf(r!)).toEqual({ firstName: '', lastName: 'Verdi Luigi (passante)' });
  });

  it('una prenotazione riproposta come commessa resta una sola, con lo stato della commessa', () => {
    const tutti = records([...RIGHE_PLANNING, RIGA_COMMESSA]);
    expect(tutti).toHaveLength(2);
    const primo = tutti.find((r) => r.idDocumento === 41001);
    expect(primo?.idCommessa).toBe(90001);
    expect(primo?.genereDoc).toBe('L');
  });

  it('le commesse senza prenotazione (le vecchie riconsegne) restano sempre fuori', () => {
    const soloCommessa: OdbcRow = { ...RIGA_COMMESSA, id_documento: null, num_doc: 500 };
    expect(records([soloCommessa])).toHaveLength(0);
  });

  it("produce il DTO dell'agenda nella stessa forma del mock, con le cancellate segnate", () => {
    const agenda = toAgendaDto(
      records([...RIGHE_PLANNING, RIGA_CANCELLATA]),
      GIORNATA,
      'Europe/Rome',
    );
    expect(agenda.businessDate).toBe(GIORNATA);
    expect(agenda.partial).toBe(false);
    const [a, b, c] = agenda.appointments;
    expect(a?.externalId).toBe('PRE-41001');
    expect(a?.scheduledAt).toBe('2023-12-28T07:30:00.000Z'); // 08:30 a Roma in dicembre
    expect(a?.brandCode).toBe('FIAT');
    expect(a?.plate).toBe('AB123CD');
    expect(a?.vin).toBe('ZFA00000000000001');
    expect(a?.vehicleModel).toBe('500X 1.3 MJET');
    expect(a?.customer).toEqual({
      externalId: '5001',
      firstName: 'MARIO',
      lastName: 'ROSSI',
      phone: '3332222222',
      email: null,
      whatsappOptIn: null,
    });
    expect(a?.serviceDescription).toBe('TAGLIANDO DI MANUTENZIONE · 6338 - SW RADIO');
    // L'accettatore a cui Infinity ha assegnato la prenotazione: «Le mie prenotazioni».
    expect(a?.advisorCode).toBe('102');
    expect(a?.advisorName).toBe('GIORGIO VERDI');
    expect(a?.cancelled).toBe(false);

    expect(b?.brandCode).toBe('ALFA_ROMEO');
    expect(b?.plate).toBe('');
    expect(b?.vehicleModel).toBe('n/d');
    expect(b?.customer.firstName).toBe('');
    expect(b?.customer.lastName).toBe('UNIPOLRENTAL SPA');
    expect(b?.serviceDescription).toBe('Rumore anteriore sinistro'); // note cliente, spazi puliti
    expect(b?.updatedAt).toBe(agenda.fetchedAt);

    expect(c?.externalId).toBe('PRE-41003');
    expect(c?.cancelled).toBe(true);
    expect(c?.customer.lastName).toBe('BIANCHI');
  });

  it('lo stato documento "Annullata" o "Chiusa in ODL" vale anche senza la procedura', () => {
    const [annullata] = records([RIGA_STATO_ANNULLATA]);
    expect(annullata?.annullata).toBe(true);
    expect(annullata?.statoDocDescrizione).toBe('Annullata');
    expect(toAgendaDto([annullata!], GIORNATA, 'Europe/Rome').appointments[0]?.cancelled).toBe(
      true,
    );
    const [chiusa] = records([
      { ...RIGHE_PLANNING[0]!, id_stato_doc: 3, stato_doc_descr: 'Chiusa in ODL' },
    ]);
    expect(chiusa?.chiusa).toBe(true);
    expect(chiusa?.annullata).toBe(false);
    // Senza descrizione (tabella stati non leggibile) valgono gli id conosciuti.
    const [soloId] = records([{ ...RIGHE_PLANNING[0]!, id_stato_doc: 18, stato_doc_descr: null }]);
    expect(soloId?.annullata).toBe(true);
    const [aperta] = records([
      { ...RIGHE_PLANNING[0]!, id_stato_doc: 0, stato_doc_descr: 'Appuntamento' },
    ]);
    expect(aperta?.annullata).toBe(false);
    expect(aperta?.chiusa).toBe(false);
  });

  it('senza colonne cognome/nome divide la ragione sociale di una persona, non di una società', () => {
    const base = records()[0]!;
    expect(customerNameOf({ ...base, clienteCognome: null, clienteNome: null })).toEqual({
      firstName: 'MARIO',
      lastName: 'ROSSI',
    });
    expect(
      customerNameOf({
        ...base,
        cliente: 'BITETTO GIANFRANCO',
        clienteCognome: null,
        clienteNome: null,
      }),
    ).toEqual({ firstName: 'GIANFRANCO', lastName: 'BITETTO' });
    expect(
      customerNameOf({
        ...base,
        cliente: '**NU**RAMO SRL',
        clienteCognome: null,
        clienteNome: null,
      }),
    ).toEqual({ firstName: '', lastName: '**NU**RAMO SRL' });
    expect(
      customerNameOf({ ...base, cliente: null, clienteCognome: null, clienteNome: null }),
    ).toEqual({
      firstName: '',
      lastName: 'Cliente 5001',
    });
  });

  it('riconosce i marchi del gruppo dalla descrizione Infinity', () => {
    expect(brandCodeFromDescription('FIAT')).toBe('FIAT');
    expect(brandCodeFromDescription('Citroën')).toBe('CITROEN');
    expect(brandCodeFromDescription('Alfa Romeo')).toBe('ALFA_ROMEO');
    expect(brandCodeFromDescription('Peugeot')).toBe('PEUGEOT');
    expect(brandCodeFromDescription('ALTRI MARCHI')).toBe('ALTRI_MARCHI');
    expect(brandCodeFromDescription(null)).toBe('SCONOSCIUTA');
  });
});

describe('InfinityServiceOdbc', () => {
  it('in auto usa la procedura nativa: sede ricavata dai tipi documento, parametri in ordine', async () => {
    const client = new FakeOdbcClient();
    const service = build(client);
    const result = await service.fetchDailyAgenda(GIORNATA);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.appointments).toHaveLength(2);
      expect(result.value.appointments[0]?.customer.lastName).toBe('ROSSI');
    }
    expect(service.planningSourceInUse).toBe('procedure');
    const sedi = client.calls.find((c) => c.sql.includes('FROM DBA.tipi_doc td'));
    expect(sedi?.params).toEqual(['PR01']);
    const proc = client.calls.find((c) => c.sql.includes('sp_off_docs_planning('));
    expect(proc?.params).toEqual([GIORNATA, '01', 'PR01']);
    expect(client.calls.some((c) => c.sql.includes('FROM DBA.tdo_pre p'))).toBe(false);
    // Le query di arricchimento ricevono gli id raccolti dal planning.
    expect(client.calls.find((c) => c.sql.includes('.mdm_pre_inc '))?.params).toEqual([
      41001, 41002,
    ]);
    expect(client.calls.find((c) => c.sql.includes('.vs_off_inc_tipoinc '))?.params).toEqual([
      41001, 41002,
    ]);
    expect(client.calls.find((c) => c.sql.includes('.telefono '))?.params).toEqual([5001, 5002]);
  });

  it('in auto senza GRANT sulla procedura ripiega sulle tabelle e non riprova alla sync successiva', async () => {
    const client = new FakeOdbcClient({ procedureError: permessoNegato('sp_off_docs_planning') });
    const service = build(client);
    const primo = await service.fetchDailyAgenda(GIORNATA);
    expect(primo.ok).toBe(true);
    if (primo.ok) {
      expect(primo.value.appointments).toHaveLength(2);
    }
    expect(service.planningSourceInUse).toBe('tables');
    const tabelle = client.calls.find((c) => c.sql.includes('FROM DBA.tdo_pre p'));
    expect(tabelle?.params).toEqual([GIORNATA, 'PR01']);

    await service.fetchDailyAgenda(GIORNATA);
    expect(client.calls.filter((c) => c.sql.includes('sp_off_docs_planning(')).length).toBe(1);
    expect(client.calls.filter((c) => c.sql.includes('FROM DBA.tdo_pre p')).length).toBe(2);
  });

  it("se la vista clienti richiama una funzione non concessa rilegge senza anagrafica, una volta sola, e l'officina non si ferma", async () => {
    const client = new FakeOdbcClient({ customerError: permessoNegato('fn_get_cons_privacy') });
    const service = build(client);
    const result = await service.fetchDailyAgenda(GIORNATA);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.appointments).toHaveLength(2);
      const [a, b] = result.value.appointments;
      expect(a?.customer.lastName).toBe('Cliente 5001');
      expect(a?.customer.firstName).toBe('');
      expect(a?.customer.phone).toBe('3332222222'); // dalla tabella telefono, ancora leggibile
      expect(b?.customer.phone).toBeNull(); // il telefono in anagrafica non c'è più
      expect(a?.plate).toBe('AB123CD');
      expect(a?.serviceDescription).toBe('TAGLIANDO DI MANUTENZIONE · 6338 - SW RADIO');
      expect(result.value.partial).toBe(false);
    }
    expect(service.planningSourceInUse).toBe('procedure');
    expect(service.customerDataAvailable).toBe(false);
    const procedura = client.calls.filter((c) => c.sql.includes('sp_off_docs_planning('));
    expect(procedura.map((c) => c.sql.includes('DBA.clienti'))).toEqual([true, false]);
    // La procedura non viene data per indisponibile: il problema era l'anagrafica.
    expect(client.calls.some((c) => c.sql.includes('FROM DBA.tdo_pre p'))).toBe(false);

    await service.fetchDailyAgenda(GIORNATA);
    expect(client.calls.filter((c) => c.sql.includes('DBA.clienti'))).toHaveLength(1);
    expect((await service.healthCheck()).detail).toContain('anagrafica non leggibile');
  });

  it("un diniego sulla testata stessa non viene scambiato per l'anagrafica: resta un errore AUTH", async () => {
    const client = new FakeOdbcClient({
      procedureError: permessoNegato('fn_getidutenticoll_doc'),
      tablesError: permessoNegato('fn_getidutenticoll_doc'),
    });
    const service = build(client);
    const result = await service.fetchDailyAgenda(GIORNATA);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('AUTH');
    }
    expect(service.customerDataAvailable).toBe(true);
  });

  it('con planningSource=procedure un errore della procedura non viene nascosto', async () => {
    const client = new FakeOdbcClient({ procedureError: permessoNegato('sp_off_docs_planning') });
    const result = await build(client, {
      ...CONFIG,
      planningSource: 'procedure',
      sede: '01',
    }).fetchDailyAgenda(GIORNATA);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('AUTH');
      expect(result.error.retryable).toBe(false);
    }
    // Con la sede in configurazione non serve la query sui tipi documento.
    expect(client.calls.some((c) => c.sql.includes('FROM DBA.tipi_doc td'))).toBe(false);
  });

  it('con planningSource=tables non tocca la procedura', async () => {
    const client = new FakeOdbcClient();
    const service = build(client, { ...CONFIG, planningSource: 'tables' });
    await service.fetchDailyAgenda(GIORNATA);
    expect(service.planningSourceInUse).toBe('tables');
    expect(client.calls.some((c) => c.sql.includes('sp_off_docs_planning('))).toBe(false);
  });

  it("un altro errore del database diventa un ProviderError e non un'eccezione", async () => {
    const client = new FakeOdbcClient({
      procedureError: new Error('[08S01] Communication link failure'),
      tablesError: new Error('[08S01] Communication link failure'),
    });
    const result = await build(client).fetchDailyAgenda(GIORNATA);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.provider).toBe('INFINITY');
      expect(result.error.code).toBe('NETWORK');
      expect(result.error.retryable).toBe(true);
    }
  });

  it('cerca per targa normalizzando spazi e minuscole', async () => {
    const client = new FakeOdbcClient();
    const result = await build(client).fetchAppointmentByPlate('ab 123 cd', GIORNATA);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value?.externalId).toBe('PRE-41001');
    }
    const proc = client.calls.find((c) => c.sql.includes('sp_off_docs_planning('));
    expect(proc?.params).toEqual([GIORNATA, '01', 'PR01', 'AB123CD']);
    const nessuna = await build(new FakeOdbcClient()).fetchAppointmentByPlate('ZZ000ZZ', GIORNATA);
    expect(nessuna.ok && nessuna.value === null).toBe(true);
  });

  it('health check UP con versione, database e sorgente; DOWN con il motivo quando la query fallisce', async () => {
    const service = build(new FakeOdbcClient());
    const prima = await service.healthCheck();
    expect(prima.status).toBe('UP');
    expect(prima.implementation).toBe('real');
    expect(prima.detail).toContain('12.0.1.4436');
    expect(prima.detail).toContain('infinity02');
    expect(prima.detail).toContain('planning auto');
    await service.fetchDailyAgenda(GIORNATA);
    expect((await service.healthCheck()).detail).toContain('planning procedure');

    class Rotto implements IOdbcClient {
      async query(): Promise<readonly OdbcRow[]> {
        throw new Error('[08001] Database server not found');
      }
    }
    const down = await build(new Rotto()).healthCheck();
    expect(down.status).toBe('DOWN');
    expect(down.detail).toContain('NETWORK');
  });

  it('la verifica di accesso elenca gli oggetti e propone il GRANT per quelli negati', async () => {
    class Parziale extends FakeOdbcClient {
      override async query(sql: string, params: readonly OdbcParam[] = []) {
        if (sql.includes('sp_off_docs_planning(')) {
          throw permessoNegato('sp_off_docs_planning');
        }
        if (sql.includes('FROM DBA.anagrafica')) {
          throw permessoNegato('fn_rimuovi_doppi_spazi');
        }
        return super.query(sql, params);
      }
    }
    const esiti = await build(new Parziale()).checkAccess(GIORNATA);
    expect(esiti.length).toBeGreaterThanOrEqual(16);
    expect(esiti.find((e) => e.oggetto === 'off_stati_doc')?.ok).toBe(true);
    const proc = esiti.find((e) => e.oggetto === 'sp_off_docs_planning');
    expect(proc?.ok).toBe(false);
    expect(proc?.livello).toBe('consigliato');
    expect(proc?.grant).toBe('GRANT EXECUTE ON DBA.sp_off_docs_planning TO <utente_dsn>;');
    expect(proc?.errore).toContain('Permission denied');
    const anagrafica = esiti.find((e) => e.oggetto === 'anagrafica');
    expect(anagrafica?.ok).toBe(false);
    expect(anagrafica?.grant).toContain('fn_rimuovi_doppi_spazi');
    expect(esiti.filter((e) => e.livello === 'obbligatorio').every((e) => e.ok)).toBe(true);
    expect(esiti.find((e) => e.oggetto === 'clienti')?.ok).toBe(true);
  });

  it('classifica gli errori del driver', () => {
    expect(classifyOdbcError(new Error('[HYT00] Query timeout expired')).code).toBe('TIMEOUT');
    expect(classifyOdbcError(new Error('[28000] Invalid user ID or password')).code).toBe('AUTH');
    expect(classifyOdbcError(new Error("[42S02] Table 'x' not found")).code).toBe(
      'INVALID_REQUEST',
    );
    expect(classifyOdbcError(new Error('[IM002] Data source name not found')).code).toBe('NETWORK');
    expect(classifyOdbcError('boh').code).toBe('PROVIDER_ERROR');
  });
});

describe('SqlAnywhereOdbcClient', () => {
  it('apre la connessione con la stringa configurata, esegue la query e chiude anche in errore', async () => {
    const eventi: string[] = [];
    const modulo: OdbcModuleLike = {
      async connect(config) {
        eventi.push(`connect:${config.connectionString}:${String(config.loginTimeout)}`);
        return {
          async query(sql: string) {
            eventi.push(`query:${sql}`);
            if (sql.includes('KO')) {
              throw new Error('[HY000] errore');
            }
            const righe = [{ a: 1 }] as unknown[] & { count?: number };
            righe.count = 1;
            return righe;
          },
          async close() {
            eventi.push('close');
          },
        };
      },
    };
    const client = new SqlAnywhereOdbcClient(
      { connectionString: 'DSN=Infinity02', loginTimeoutSec: 7, queryTimeoutSec: 30 },
      async () => modulo,
    );
    const righe = await client.query('SELECT 1 AS a');
    expect(righe).toEqual([{ a: 1 }]);
    await expect(client.query('SELECT KO')).rejects.toThrow('HY000');
    expect(eventi).toEqual([
      'connect:DSN=Infinity02:7',
      'query:SELECT 1 AS a',
      'close',
      'connect:DSN=Infinity02:7',
      'query:SELECT KO',
      'close',
    ]);
  });
});

describe('Verifica accessi: il GRANT proposto segue il messaggio del database', () => {
  it("quando il diniego nomina una funzione richiamata dalla tabella propone l'EXECUTE su quella", async () => {
    class ColonneCalcolate extends FakeOdbcClient {
      override async query(sql: string, params: readonly OdbcParam[] = []) {
        if (sql.includes('FROM DBA.tdo_pre')) {
          throw new Error(
            '[42000] [Sybase][ODBC Driver][SQL Anywhere]Permission denied: you do not have permission to execute the procedure "fn_getidutenticoll_doc"',
          );
        }
        if (sql.includes('FROM DBA.clienti')) {
          throw new Error(
            '[42000] [Sybase][ODBC Driver][SQL Anywhere]Permission denied: you do not have permission to execute the procedure "fn_get_last_email"',
          );
        }
        if (sql.includes('FROM DBA.contatti')) {
          throw new Error(
            '[42501] [Sybase][ODBC Driver][SQL Anywhere]Permission denied: you do not have permission to select from "contatti"',
          );
        }
        return super.query(sql, params);
      }
    }
    const esiti = await build(new ColonneCalcolate(), {
      ...CONFIG,
      planningSource: 'tables',
    }).checkAccess(GIORNATA);
    expect(esiti.find((e) => e.oggetto === 'tdo_pre')?.grant).toBe(
      'GRANT EXECUTE ON DBA.fn_getidutenticoll_doc TO <utente_dsn>;  -- richiamata leggendo tdo_pre',
    );
    expect(esiti.find((e) => e.oggetto === 'clienti')?.grant).toContain('fn_get_last_email');
    // Diniego senza funzione nominata: resta la SELECT sulla tabella.
    expect(esiti.find((e) => e.oggetto === 'contatti')?.grant).toBe(
      'GRANT SELECT ON DBA.contatti TO <utente_dsn>;',
    );
    expect(
      deniedProcedureIn('Permission denied: you do not have permission to select from "x"'),
    ).toBeNull();
  });

  it('gli attributi aggiuntivi si appendono alla stringa di connessione e si descrivono senza password', () => {
    const conExtra = {
      ...CONFIG,
      dsn: 'Infinity01',
      extra: 'Host=10.10.193.18:2638;PWD=segretissima',
    };
    expect(buildConnectionString(conExtra)).toBe(
      'DSN=Infinity01;Host=10.10.193.18:2638;PWD=segretissima;CharSet=UTF-8',
    );
    expect(describeConnection(conExtra)).toContain('Host=10.10.193.18:2638;PWD=***');
    expect(describeConnection(conExtra)).not.toContain('segretissima');
  });
});
