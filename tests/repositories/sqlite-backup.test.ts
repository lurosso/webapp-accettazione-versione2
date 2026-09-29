// Copia notturna del database (M8-T58) su un SQLite VERO: la copia si riapre e contiene i dati,
// c'è una copia per giornata, un provvisorio rimasto si toglie, le copie vecchie si potano.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IsoDate } from '@/domain/value-objects/iso-date';
import {
  createPrismaClient,
  PrismaAppointmentRepository,
  SqliteDatabaseBackup,
  type Db,
} from '@/repositories/prisma';
import { NoDatabaseBackup } from '@/repositories/in-memory';
import { makeAppointment, TestClock } from '../helpers/fixtures';

async function migra(db: Db): Promise<void> {
  const cartella = join(process.cwd(), 'prisma', 'migrations');
  for (const nome of readdirSync(cartella)
    .filter((n) => /^\d{14}_/.test(n))
    .sort()) {
    const sql = readFileSync(join(cartella, nome, 'migration.sql'), 'utf8');
    for (const istruzione of sql.split(/;\s*\n/)) {
      const pulita = istruzione.replace(/^\s*--.*$/gm, '').trim();
      if (pulita.length > 0) {
        await db.$executeRawUnsafe(pulita);
      }
    }
  }
}

const url = (file: string) => `file:${file.replaceAll('\\', '/')}`;

let cartella: string;
let copie: string;
let db: Db;

beforeAll(async () => {
  cartella = mkdtempSync(join(tmpdir(), 'accettazione-backup-'));
  copie = join(cartella, 'backup');
  db = createPrismaClient(url(join(cartella, 'accettazione.db')));
  await migra(db);
  const r = await new PrismaAppointmentRepository(db, new TestClock()).insert(makeAppointment());
  expect(r.ok).toBe(true);
});

afterAll(async () => {
  await db.$disconnect();
  rmSync(cartella, { recursive: true, force: true });
});

describe('SqliteDatabaseBackup', () => {
  it('scrive una copia coerente che si riapre e contiene i dati', async () => {
    const backup = new SqliteDatabaseBackup(db, { dir: copie, keepDays: 14 });
    const giorno = '2026-09-29' as IsoDate;
    expect(await backup.hasBackupFor(giorno)).toBe(false);

    const esito = await backup.backup(giorno);
    expect(esito.file).toBe(join(copie, 'accettazione-2026-09-29.db'));
    expect(esito.bytes).toBeGreaterThan(0);
    expect(await backup.hasBackupFor(giorno)).toBe(true);
    expect(existsSync(`${esito.file}.parziale`)).toBe(false);

    const copia = createPrismaClient(url(esito.file));
    try {
      const righe = await copia.$queryRawUnsafe<{ n: number | bigint }[]>(
        'SELECT COUNT(*) AS n FROM Appointment',
      );
      expect(Number(righe[0]?.n)).toBe(1);
    } finally {
      await copia.$disconnect();
    }
  });

  it('un provvisorio rimasto da un giro interrotto non blocca la copia', async () => {
    const backup = new SqliteDatabaseBackup(db, { dir: copie, keepDays: 14 });
    writeFileSync(join(copie, 'accettazione-2026-09-30.db.parziale'), 'mezza copia');
    const esito = await backup.backup('2026-09-30' as IsoDate);
    expect(existsSync(esito.file)).toBe(true);
    expect(existsSync(`${esito.file}.parziale`)).toBe(false);
  });

  it('dopo una copia toglie quelle più vecchie della conservazione, e solo quelle', async () => {
    const backup = new SqliteDatabaseBackup(db, { dir: copie, keepDays: 3 });
    for (const vecchio of ['2026-09-20', '2026-09-26', '2026-09-27']) {
      writeFileSync(join(copie, `accettazione-${vecchio}.db`), 'x');
    }
    writeFileSync(join(copie, 'altro-file.txt'), 'non si tocca');
    const esito = await backup.backup('2026-10-01' as IsoDate);
    // Limite: 2026-10-01 meno 3 giorni = 2026-09-28; restano quelle dal 28 in poi.
    expect(esito.removed).toBe(3);
    expect(readdirSync(copie).sort()).toEqual([
      'accettazione-2026-09-29.db',
      'accettazione-2026-09-30.db',
      'accettazione-2026-10-01.db',
      'altro-file.txt',
    ]);
  });
});

describe('NoDatabaseBackup', () => {
  it('con la persistenza in memoria non c’è niente da copiare', async () => {
    const backup = new NoDatabaseBackup();
    expect(backup.supported).toBe(false);
    expect(await backup.hasBackupFor('2026-09-29' as IsoDate)).toBe(true);
  });
});
