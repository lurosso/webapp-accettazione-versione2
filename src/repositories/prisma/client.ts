// Il client Prisma dell'applicazione: SQLite in un file, aperto tramite `better-sqlite3`.
//
// Prisma 7 non ha più il motore Rust: parla con il database attraverso un "driver adapter", e per
// SQLite l'adapter usa `better-sqlite3`, un modulo nativo (è fra i `serverExternalPackages` di
// Next, come `odbc`). Il processo è uno solo e SQLite serializza le scritture da sé: nessun pool,
// nessun server da tenere acceso, e il backup è la copia di un file.
//
// Un client per URL, memorizzato su `globalThis`: in sviluppo l'HMR rivaluta i moduli, e ogni
// rivalutazione aprirebbe un altro handle sullo stesso file finché il processo non li esaurisce.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { sqlitePathFrom } from '@/config/database-url';
import { PrismaClient } from '@/generated/prisma/client';

export type Db = PrismaClient;

/** Apre (o crea) il database all'URL indicato. La cartella del file viene creata se manca. */
export function createPrismaClient(databaseUrl: string): Db {
  const percorso = sqlitePathFrom(databaseUrl);
  if (percorso !== ':memory:') {
    mkdirSync(dirname(percorso), { recursive: true });
  }
  const adapter = new PrismaBetterSqlite3({ url: percorso });
  return new PrismaClient({ adapter });
}

const GLOBAL_KEY = '__accettazionePrisma';

/** Il client condiviso del processo per questo URL; sopravvive all'HMR di Next. */
export function getSharedPrismaClient(databaseUrl: string): Db {
  const g = globalThis as unknown as Record<string, unknown>;
  const cache = (g[GLOBAL_KEY] ??= new Map<string, Db>()) as Map<string, Db>;
  let client = cache.get(databaseUrl);
  if (client === undefined) {
    client = createPrismaClient(databaseUrl);
    cache.set(databaseUrl, client);
  }
  return client;
}
