// L'indirizzo del database, in un posto solo per la CLI di Prisma e per l'applicazione.
//
// `DATABASE_URL` è un URL SQLite (`file:./.data/accettazione.db`); se manca vale il predefinito,
// così un'installazione nuova parte senza configurare niente. `better-sqlite3` non parla URL ma
// percorsi: `sqlitePathFrom` toglie lo schema `file:` e risolve i percorsi relativi dalla radice
// del progetto, così la CLI (che vuole l'URL) e l'adapter (che vuole il percorso) aprono lo stesso
// file. `:memory:` resta com'è: è il database volatile dei test.
import { isAbsolute, resolve } from 'node:path';

export const DEFAULT_DATABASE_URL = 'file:./.data/accettazione.db';

/** L'URL del database da un insieme di variabili d'ambiente, con il predefinito. */
export function databaseUrlFromEnv(source: Readonly<Record<string, string | undefined>>): string {
  const valore = source['DATABASE_URL']?.trim();
  return valore === undefined || valore === '' ? DEFAULT_DATABASE_URL : valore;
}

/** Il percorso su disco che `better-sqlite3` deve aprire per un URL SQLite. */
export function sqlitePathFrom(url: string, root: string = process.cwd()): string {
  if (url === ':memory:' || url === 'file::memory:') {
    return ':memory:';
  }
  const senzaSchema = url.startsWith('file:') ? url.slice('file:'.length) : url;
  // `file:///C:/...` o `file:///var/...`: lo slash iniziale va tolto solo su Windows.
  const percorso = senzaSchema.startsWith('///') ? senzaSchema.slice(2) : senzaSchema;
  const pulito = /^\/[A-Za-z]:[\\/]/.test(percorso) ? percorso.slice(1) : percorso;
  return isAbsolute(pulito) ? pulito : resolve(root, pulito);
}
