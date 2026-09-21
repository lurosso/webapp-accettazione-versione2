// Configurazione della CLI di Prisma 7: dove sta lo schema, dove vanno le migrazioni, che database
// usare. In Prisma 7 l'indirizzo del database non sta più nello schema ma qui, e la CLI non legge
// da sola i file `.env*`: lo stesso valore predefinito di `src/config/env.ts` vale anche qui, così
// `prisma migrate` e l'applicazione parlano con lo stesso file senza configurare niente.
//
// SQLite in un file dentro `.data/` (già fuori da git): un'officina con un solo server non ha
// bisogno di un database separato da installare e tenere acceso, e il file si copia per il backup.
import { defineConfig } from 'prisma/config';
import { databaseUrlFromEnv } from './src/config/database-url';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: databaseUrlFromEnv(process.env) },
});
