// Copia del database con la persistenza in memoria: non c'è niente da copiare, e sparisce comunque
// al riavvio. Il temporizzatore la salta (`supported: false`).
import type { IsoDate } from '@/domain/value-objects/iso-date';
import type { DatabaseBackupResult, IDatabaseBackup } from '../interfaces/IDatabaseBackup';

export class NoDatabaseBackup implements IDatabaseBackup {
  readonly supported = false;

  async hasBackupFor(_businessDate: IsoDate): Promise<boolean> {
    return true;
  }

  async backup(_businessDate: IsoDate): Promise<DatabaseBackupResult> {
    return { file: '', bytes: 0, removed: 0 };
  }
}
