// Configurazione dell'adapter ODBC verso il database Infinity (Zucchetti, motore SQL Anywhere 12).
//
// Il DSN è definito nel sistema operativo (ODBC a 64 bit) e di norma porta già utente e password:
// l'applicazione passa solo `DSN=<nome>`. Cambiare database (infinity02 di prova → infinity01 di
// produzione) è cambiare una variabile d'ambiente, non una riga di codice. Le credenziali, se il
// DSN non le contiene, arrivano da variabili dedicate e NON entrano mai nell'AppEnv serializzato.

/** Motori supportati. Oggi solo SQL Anywhere 12; il nome resta esplicito per il giorno del cambio. */
export type InfinityDbType = 'sql_anywhere_12';

export const INFINITY_DB_TYPES: readonly InfinityDbType[] = ['sql_anywhere_12'];

/**
 * Da dove leggere il planning:
 * - `procedure`: la procedura nativa `sp_off_docs_planning` (la stessa del planning di Infinity),
 *   che richiede il GRANT EXECUTE all'utenza del DSN;
 * - `tables`: lettura diretta di `tdo_pre` e tabelle collegate (funziona con la sola SELECT);
 * - `auto` (predefinito): prova la procedura e, se non è concessa, ripiega sulle tabelle avvisando.
 */
export type InfinityPlanningSource = 'auto' | 'procedure' | 'tables';

export const INFINITY_PLANNING_SOURCES: readonly InfinityPlanningSource[] = [
  'auto',
  'procedure',
  'tables',
];

export interface InfinityOdbcConfig {
  /** Nome del DSN di sistema (es. "Infinity02"). */
  readonly dsn: string;
  readonly dbType: InfinityDbType;
  /** Solo se il DSN non memorizza le credenziali. */
  readonly uid: string | null;
  readonly pwd: string | null;
  /** Proprietario delle tabelle applicative (in Infinity: DBA). */
  readonly schema: string;
  /** Tipi documento che rappresentano una prenotazione del planning (es. PR01). */
  readonly bookingDocTypes: readonly string[];
  readonly planningSource: InfinityPlanningSource;
  /** Codice sede per la procedura (`tipi_doc.sede_cont`, es. "01"); null = ricavato dai tipi documento. */
  readonly sede: string | null;
  /** Includere anche le commesse in consegna (genere L) oltre alle prenotazioni (genere Z). */
  readonly includeWorkOrders: boolean;
  /** Fuso dell'officina: data + ora della prenotazione sono orari locali senza offset. */
  readonly timeZone: string;
  readonly loginTimeoutSec: number;
  readonly queryTimeoutSec: number;
}

/** Valori con `;` o `}` vanno racchiusi fra graffe, come da sintassi ODBC. */
function odbcValue(value: string): string {
  return /[;{}]/.test(value) ? `{${value.replace(/}/g, '}}')}}` : value;
}

/** Stringa di connessione ODBC: DSN più, solo se presenti, utente e password. */
export function buildConnectionString(config: InfinityOdbcConfig): string {
  const parti = [`DSN=${odbcValue(config.dsn)}`];
  if (config.uid !== null && config.uid !== '') {
    parti.push(`UID=${odbcValue(config.uid)}`);
  }
  if (config.pwd !== null && config.pwd !== '') {
    parti.push(`PWD=${odbcValue(config.pwd)}`);
  }
  return parti.join(';');
}

/** Descrizione per i log e la diagnostica: mai la password. */
export function describeConnection(config: InfinityOdbcConfig): string {
  const credenziali =
    config.uid === null || config.uid === ''
      ? 'credenziali dal DSN'
      : `utente ${config.uid}${config.pwd === null || config.pwd === '' ? '' : ', password impostata'}`;
  return `DSN=${config.dsn} (${config.dbType}, schema ${config.schema}, ${credenziali}, documenti ${config.bookingDocTypes.join('/')}, planning ${config.planningSource}${config.sede === null ? '' : `, sede ${config.sede}`})`;
}
