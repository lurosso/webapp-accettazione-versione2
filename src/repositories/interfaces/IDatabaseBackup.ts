// Copia del database dell'accettazione per il backup (M8-T58).
//
// Il backup della macchina virtuale copia il file del database mentre il programma scrive, e una
// copia presa a metà di una scrittura può non riaprirsi. Una volta al giorno il programma fa quindi
// da sé una copia coerente in una cartella del volume dati, e il backup del server la porta via.
import type { IsoDate } from '@/domain/value-objects/iso-date';

/** Com'è andata una copia. */
export interface DatabaseBackupResult {
  /** Il file scritto. */
  readonly file: string;
  readonly bytes: number;
  /** Copie più vecchie della conservazione tolte in questo giro. */
  readonly removed: number;
}

export interface IDatabaseBackup {
  /** False quando non c'è niente da copiare (persistenza in memoria dei test e delle demo). */
  readonly supported: boolean;
  /** True se la copia di quella giornata c'è già. */
  hasBackupFor(businessDate: IsoDate): Promise<boolean>;
  /** Copia coerente del database per quella giornata; poi toglie le copie troppo vecchie. */
  backup(businessDate: IsoDate): Promise<DatabaseBackupResult>;
}
