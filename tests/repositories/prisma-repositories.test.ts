// I repository Prisma su un SQLite VERO, in un file temporaneo: stesse regole della memoria, più
// quella che la memoria non può avere — sopravvivere alla chiusura del processo.
//
// Lo schema arriva dalla migrazione generata (`prisma/migrations/*/migration.sql`), applicata
// istruzione per istruzione: così il test prova esattamente le tabelle che finiscono in officina,
// non una copia. Un file per suite, cancellato alla fine; il database di sviluppo non si tocca.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Appointment } from '@/domain/entities/appointment';
import { asOperatorId, asWorkstationId } from '@/domain/ids';
import type { IsoDate, IsoDateTime } from '@/domain/value-objects/iso-date';
import {
  createPrismaClient,
  PrismaAppointmentRepository,
  PrismaMediaRepository,
  PrismaOperatorRepository,
  PrismaWorkstationClaimRepository,
  type Db,
} from '@/repositories/prisma';
import { makeAppointment, TestClock } from '../helpers/fixtures';

/** Applica la migrazione iniziale a un database appena creato. */
async function migra(db: Db): Promise<void> {
  const cartella = join(process.cwd(), 'prisma', 'migrations');
  const migrazioni = readdirSync(cartella)
    .filter((n) => /^\d{14}_/.test(n))
    .sort();
  for (const nome of migrazioni) {
    const sql = readFileSync(join(cartella, nome, 'migration.sql'), 'utf8');
    for (const istruzione of sql.split(/;\s*\n/)) {
      const pulita = istruzione.replace(/^\s*--.*$/gm, '').trim();
      if (pulita.length > 0) {
        await db.$executeRawUnsafe(pulita);
      }
    }
  }
}

let cartella: string;
let url: string;
let db: Db;
const clock = new TestClock();

beforeAll(async () => {
  cartella = mkdtempSync(join(tmpdir(), 'accettazione-prisma-'));
  url = `file:${join(cartella, 'test.db').replaceAll('\\', '/')}`;
  db = createPrismaClient(url);
  await migra(db);
});

afterAll(async () => {
  await db.$disconnect();
  rmSync(cartella, { recursive: true, force: true });
});

describe('PrismaAppointmentRepository', () => {
  it('inserisce, ritrova per id, codice, riferimento e targa, e la giornata è ordinata', async () => {
    const repo = new PrismaAppointmentRepository(db, clock);
    const a = makeAppointment({ businessDate: '2026-09-21' as IsoDate });
    const b = makeAppointment({ businessDate: '2026-09-21' as IsoDate });
    expect((await repo.insert(a)).ok).toBe(true);
    expect((await repo.insert(b)).ok).toBe(true);

    expect((await repo.findById(a.id))?.code).toBe(a.code);
    expect((await repo.findByCode(a.code, a.businessDate))?.id).toBe(a.id);
    expect((await repo.findByExternalRef(a.externalRef ?? '', a.businessDate))?.id).toBe(a.id);
    expect((await repo.findByPlate(a.vehicle.plate, a.businessDate)).map((x) => x.id)).toContain(
      a.id,
    );
    // Cliente e veicolo tornano interi dalle colonne JSON.
    expect((await repo.findById(a.id))?.customer).toEqual(a.customer);
    expect((await repo.findById(a.id))?.vehicle).toEqual(a.vehicle);

    const giornata = await repo.listByDate(a.businessDate);
    expect(giornata.map((x) => x.id)).toEqual([a.id, b.id]);
  });

  it('rifiuta i doppioni con gli stessi errori della memoria', async () => {
    const repo = new PrismaAppointmentRepository(db, clock);
    const a = makeAppointment({ businessDate: '2026-09-22' as IsoDate });
    expect((await repo.insert(a)).ok).toBe(true);

    const stessoId = await repo.insert(a);
    expect(!stessoId.ok && stessoId.error.code).toBe('VALIDATION');
    const stessoCodice = await repo.insert(
      makeAppointment({ businessDate: a.businessDate, code: a.code }),
    );
    expect(!stessoCodice.ok && stessoCodice.error.message).toContain('già assegnato');
    const stessoRef = await repo.insert(
      makeAppointment({ businessDate: a.businessDate, externalRef: a.externalRef }),
    );
    expect(!stessoRef.ok && stessoRef.error.message).toContain('già presente nella giornata');
  });

  it('la concorrenza ottimistica passa dal database: versione sbagliata → VERSION_CONFLICT', async () => {
    const repo = new PrismaAppointmentRepository(db, clock);
    const a = makeAppointment({ businessDate: '2026-09-23' as IsoDate });
    await repo.insert(a);

    const prima = await repo.update({ ...a, notes: 'prima postazione' }, a.version);
    expect(prima.ok && prima.value.version).toBe(a.version + 1);
    expect(prima.ok && prima.value.notes).toBe('prima postazione');

    const seconda = await repo.update({ ...a, notes: 'seconda postazione' }, a.version);
    expect(!seconda.ok && seconda.error.code).toBe('VERSION_CONFLICT');
    expect(!seconda.ok && seconda.error.details?.['currentVersion']).toBe(a.version + 1);

    const ignota = await repo.update({ ...a, id: 'app-ignota' as Appointment['id'] }, 1);
    expect(!ignota.ok && ignota.error.code).toBe('NOT_FOUND');
  });

  it('i filtri della giornata: flusso, annullate, stati, sportelli', async () => {
    const repo = new PrismaAppointmentRepository(db, clock);
    const giorno = '2026-09-24' as IsoDate;
    await repo.insert(makeAppointment({ businessDate: giorno, status: 'WAITING' }));
    await repo.insert(makeAppointment({ businessDate: giorno, status: 'CANCELLED' }));
    await repo.insert(makeAppointment({ businessDate: giorno, flow: 'RETURN', status: 'WAITING' }));

    expect(await repo.listByDate(giorno)).toHaveLength(1);
    expect(await repo.listByDate(giorno, { includeCancelled: true })).toHaveLength(2);
    expect(await repo.listByDate(giorno, { flow: 'ALL', includeCancelled: true })).toHaveLength(3);
    expect(await repo.listByDate(giorno, { statuses: ['CANCELLED'] })).toHaveLength(1);
    expect(await repo.listByDate(giorno, { flow: 'RETURN' })).toHaveLength(1);
  });

  it('il contatore dei codici è atomico e non ridà mai un numero', async () => {
    const repo = new PrismaAppointmentRepository(db, clock);
    const giorno = '2026-09-25' as IsoDate;
    const numeri = await Promise.all(
      [1, 2, 3, 4, 5].map(() => repo.reserveNextSequence(giorno, 'F')),
    );
    expect([...numeri].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5]);
    expect(await repo.reserveNextSequence(giorno, 'R')).toBe(1);
    expect(await repo.reserveNextSequence(giorno, 'F')).toBe(6);
  });

  it('la ricerca in archivio trova per pezzo di targa e di codice, dal più recente', async () => {
    const repo = new PrismaAppointmentRepository(db, clock);
    const vecchia = makeAppointment({ businessDate: '2026-06-10' as IsoDate });
    const nuova = makeAppointment({
      businessDate: '2026-09-26' as IsoDate,
      vehicle: { ...vecchia.vehicle },
    });
    await repo.insert(vecchia);
    await repo.insert(nuova);

    const perTarga = await repo.searchHistory({ plate: vecchia.vehicle.plate.slice(0, 4) }, 10);
    expect(perTarga.map((x) => x.id)).toEqual([nuova.id, vecchia.id]);
    const perCodice = await repo.searchHistory({ code: vecchia.code.toLowerCase() }, 10);
    expect(perCodice.some((x) => x.id === vecchia.id)).toBe(true);
    expect(await repo.searchHistory({}, 10)).toEqual([]);
  });
});

describe('PrismaMediaRepository', () => {
  it('scadute, archiviate ed eliminazione seguono le stesse regole della memoria', async () => {
    const appointments = new PrismaAppointmentRepository(db, clock);
    const media = new PrismaMediaRepository(db);
    const a = makeAppointment({ businessDate: '2026-09-27' as IsoDate });
    await appointments.insert(a);
    const base = {
      appointmentId: a.id,
      kind: 'PHOTO' as const,
      category: 'FRONT' as const,
      mimeType: 'image/jpeg',
      sizeBytes: 100,
      thumbnailKey: null,
      capturedByOperatorId: asOperatorId('op-1'),
      note: null,
      archivedAt: null,
    };
    await media.insert({
      ...base,
      id: 'm-scaduta' as never,
      storageKey: 'k/scaduta.jpg',
      capturedAt: '2026-06-01T08:00:00.000Z' as IsoDateTime,
      expiresAt: '2026-08-30T08:00:00.000Z' as IsoDateTime,
    });
    await media.insert({
      ...base,
      id: 'm-viva' as never,
      storageKey: 'k/viva.jpg',
      capturedAt: '2026-09-20T08:00:00.000Z' as IsoDateTime,
      expiresAt: '2026-12-19T08:00:00.000Z' as IsoDateTime,
    });

    const adesso = '2026-09-21T10:00:00.000Z' as IsoDateTime;
    expect((await media.listExpired(adesso)).map((m) => m.id)).toEqual(['m-scaduta']);
    expect((await media.listByAppointment(a.id)).map((m) => m.id)).toEqual(['m-scaduta', 'm-viva']);

    const scaduta = (await media.listExpired(adesso))[0];
    if (scaduta === undefined) {
      throw new Error('attesa una scaduta');
    }
    await media.update({ ...scaduta, archivedAt: adesso });
    expect(await media.listExpired(adesso)).toHaveLength(0);
    expect(
      (await media.listArchivedBefore('2026-12-31T00:00:00.000Z' as IsoDateTime)).map((m) => m.id),
    ).toEqual(['m-scaduta']);

    await media.delete(scaduta.id);
    await media.delete(scaduta.id); // già eliminato: non è un errore
    expect((await media.listByAppointment(a.id)).map((m) => m.id)).toEqual(['m-viva']);
  });
});

describe('PrismaWorkstationClaimRepository', () => {
  it('un posto per operatore: upsert, attive, liberazione per operatore e per postazione', async () => {
    const repo = new PrismaWorkstationClaimRepository(db);
    const adesso = '2026-09-21T10:00:00.000Z' as IsoDateTime;
    await repo.upsert({
      workstationId: asWorkstationId('ws-p1'),
      operatorId: asOperatorId('op-mario'),
      operatorName: 'Mario',
      claimedAt: adesso,
      expiresAt: '2026-09-21T18:00:00.000Z' as IsoDateTime,
    });
    await repo.upsert({
      workstationId: asWorkstationId('ws-p2'),
      operatorId: asOperatorId('op-laura'),
      operatorName: 'Laura',
      claimedAt: adesso,
      expiresAt: '2026-09-21T09:00:00.000Z' as IsoDateTime, // già scaduta
    });
    expect((await repo.listActive(adesso)).map((c) => c.operatorName)).toEqual(['Mario']);
    expect((await repo.findByWorkstation(asWorkstationId('ws-p2')))?.operatorName).toBe('Laura');

    await repo.deleteByOperator(asOperatorId('op-mario'));
    expect(await repo.findByWorkstation(asWorkstationId('ws-p1'))).toBeNull();
    await repo.deleteByWorkstation(asWorkstationId('ws-p2'));
    expect(await repo.findByWorkstation(asWorkstationId('ws-p2'))).toBeNull();
  });
});

describe('PrismaOperatorRepository', () => {
  it('il seed entra solo a tabella vuota, e le modifiche dopo vincono sul seed', async () => {
    const seme = {
      id: asOperatorId('op-admin'),
      username: 'Admin',
      displayName: 'Amministratore',
      role: 'ADMIN' as const,
      deskIds: [],
      defaultWorkstationId: null,
      passwordHash: 'hash-iniziale',
      isActive: true,
      mustChangePassword: true,
    };
    const primo = new PrismaOperatorRepository(db, [seme]);
    expect((await primo.findByUsername('admin'))?.passwordHash).toBe('hash-iniziale');

    await primo.update({ ...seme, passwordHash: 'hash-nuovo', mustChangePassword: false });

    // Un nuovo repository con lo stesso seed (un riavvio): la tabella non è vuota, il seed non tocca.
    const dopoRiavvio = new PrismaOperatorRepository(db, [seme]);
    const letto = await dopoRiavvio.findById(seme.id);
    expect(letto?.passwordHash).toBe('hash-nuovo');
    expect(letto?.mustChangePassword).toBe(false);
    expect((await dopoRiavvio.listAll()).length).toBe(1);
  });
});

describe('sopravvivenza al riavvio', () => {
  it('un altro processo che apre lo stesso file ritrova pratica, vincolo legale e foto', async () => {
    const appointments = new PrismaAppointmentRepository(db, clock);
    const media = new PrismaMediaRepository(db);
    const a = makeAppointment({
      businessDate: '2026-09-28' as IsoDate,
      status: 'COMPLETED',
      legalHoldAt: '2026-09-21T09:00:00.000Z' as IsoDateTime,
      legalHoldReason: 'Contestazione',
    });
    await appointments.insert(a);
    await media.insert({
      id: 'm-riavvio' as never,
      appointmentId: a.id,
      kind: 'VIDEO',
      category: null,
      mimeType: 'video/mp4',
      sizeBytes: 4096,
      storageKey: '2026-09-28/F001/video-m-riavvio.mp4',
      thumbnailKey: null,
      capturedByOperatorId: asOperatorId('op-1'),
      capturedAt: '2026-09-28T08:00:00.000Z' as IsoDateTime,
      note: null,
      expiresAt: '2026-12-27T08:00:00.000Z' as IsoDateTime,
      archivedAt: null,
    });

    // «Riavvio»: un client nuovo sullo stesso file, come farebbe il processo successivo.
    const altro = createPrismaClient(url);
    try {
      const riletta = await new PrismaAppointmentRepository(altro, clock).findById(a.id);
      expect(riletta?.legalHoldAt).toBe('2026-09-21T09:00:00.000Z');
      expect(riletta?.legalHoldReason).toBe('Contestazione');
      const foto = await new PrismaMediaRepository(altro).listByAppointment(a.id);
      expect(foto.map((m) => m.storageKey)).toEqual(['2026-09-28/F001/video-m-riavvio.mp4']);
    } finally {
      await altro.$disconnect();
    }
  });
});
