// Copia coerente del database SQLite con `VACUUM INTO` (M8-T58).
//
// `VACUUM INTO` scrive in un file nuovo un'istantanea coerente del database, anche mentre il
// programma lavora: è il modo che SQLite stesso indica per un backup a caldo. La copia si scrive
// prima con un nome provvisorio e poi si rinomina, così nella cartella c'è solo una copia intera o
// nessuna. Un file per giornata (`accettazione-AAAA-MM-GG.db`); quelli più vecchi della
// conservazione si tolgono dopo ogni copia riuscita.
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { IsoDate } from '@/domain/value-objects/iso-date';
import { addDays } from '@/lib/dates';
import type { DatabaseBackupResult, IDatabaseBackup } from '../interfaces/IDatabaseBackup';
import type { Db } from './client';

export interface SqliteDatabaseBackupOptions {
  /** Cartella delle copie (DB_BACKUP_DIR). */
  readonly dir: string;
  /** Giorni di conservazione (DB_BACKUP_KEEP_DAYS). */
  readonly keepDays: number;
}

const NOME = /^accettazione-(\d{4}-\d{2}-\d{2})\.db$/;

export class SqliteDatabaseBackup implements IDatabaseBackup {
  readonly supported = true;

  constructor(
    private readonly db: Db,
    private readonly options: SqliteDatabaseBackupOptions,
  ) {}

  private fileFor(businessDate: IsoDate): string {
    return join(this.options.dir, `accettazione-${businessDate}.db`);
  }

  async hasBackupFor(businessDate: IsoDate): Promise<boolean> {
    return existsSync(this.fileFor(businessDate));
  }

  async backup(businessDate: IsoDate): Promise<DatabaseBackupResult> {
    mkdirSync(this.options.dir, { recursive: true });
    const file = this.fileFor(businessDate);
    const provvisorio = `${file}.parziale`;
    // `VACUUM INTO` non sovrascrive: un provvisorio rimasto da un giro interrotto va tolto.
    rmSync(provvisorio, { force: true });
    await this.db.$executeRaw`VACUUM INTO ${provvisorio}`;
    renameSync(provvisorio, file);
    return { file, bytes: statSync(file).size, removed: this.prune(businessDate) };
  }

  /** Toglie le copie più vecchie di `keepDays` giorni rispetto alla giornata indicata. */
  private prune(businessDate: IsoDate): number {
    const limite = addDays(businessDate, -this.options.keepDays);
    let tolte = 0;
    for (const nome of readdirSync(this.options.dir)) {
      const giorno = NOME.exec(nome)?.[1];
      if (giorno !== undefined && giorno < limite) {
        rmSync(join(this.options.dir, nome), { force: true });
        tolte += 1;
      }
    }
    return tolte;
  }
}
