// Client ODBC minimo per SQL Anywhere: apre una connessione per ogni query, esegue una SELECT
// parametrica, chiude. Il modulo nativo `odbc` viene caricato solo alla prima chiamata: chi gira in
// modalità mock non deve nemmeno avere il driver installato, e il bundler non lo tocca.
//
// L'interfaccia `IOdbcClient` è ciò che il servizio Infinity vede: nei test si sostituisce con un
// finto che restituisce righe già pronte, senza database.

export type OdbcParam = string | number | null;

/** Riga come la restituisce il driver: valori grezzi (stringhe, numeri, Date, null). */
export type OdbcRow = Readonly<Record<string, unknown>>;

export interface IOdbcClient {
  /** Esegue una SELECT con parametri posizionali (`?`). Solo lettura: il chiamante non manda altro. */
  query(sql: string, params?: readonly OdbcParam[]): Promise<readonly OdbcRow[]>;
}

/** Sottoinsieme del modulo `odbc` che usiamo, dichiarato qui per non dipendere dai suoi tipi. */
export interface OdbcModuleLike {
  connect(config: {
    readonly connectionString: string;
    readonly connectionTimeout?: number;
    readonly loginTimeout?: number;
  }): Promise<OdbcConnectionLike>;
}

export interface OdbcConnectionLike {
  query(sql: string, params?: readonly OdbcParam[]): Promise<unknown>;
  close(): Promise<void>;
}

export interface SqlAnywhereOdbcClientOptions {
  readonly connectionString: string;
  readonly loginTimeoutSec: number;
  readonly queryTimeoutSec: number;
}

/** Caricatore del modulo nativo, sostituibile nei test. */
export type OdbcLoader = () => Promise<OdbcModuleLike>;

const defaultLoader: OdbcLoader = async () => {
  // Import dinamico: il modulo nativo resta fuori dal bundle e dal percorso mock.
  const mod = (await import('odbc')) as unknown as OdbcModuleLike & { default?: OdbcModuleLike };
  return typeof mod.connect === 'function' ? mod : (mod.default as OdbcModuleLike);
};

export class SqlAnywhereOdbcClient implements IOdbcClient {
  constructor(
    private readonly options: SqlAnywhereOdbcClientOptions,
    private readonly loader: OdbcLoader = defaultLoader,
  ) {}

  async query(sql: string, params: readonly OdbcParam[] = []): Promise<readonly OdbcRow[]> {
    const odbc = await this.loader();
    const connection = await odbc.connect({
      connectionString: this.options.connectionString,
      connectionTimeout: this.options.queryTimeoutSec,
      loginTimeout: this.options.loginTimeoutSec,
    });
    try {
      const result = await connection.query(sql, params);
      // `odbc` restituisce un array di righe con proprietà aggiuntive (columns, count...):
      // si tengono solo le righe, come oggetti semplici.
      return Array.isArray(result)
        ? result.map((row) => ({ ...(row as Record<string, unknown>) }))
        : [];
    } finally {
      await connection.close().catch(() => undefined);
    }
  }
}
