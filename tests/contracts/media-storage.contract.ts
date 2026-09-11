// Suite di contratto di `IMediaStorage`: le stesse prove girano sul mock in memoria e sullo
// storage su disco. È il patto che permette di cambiare implementazione senza toccare
// `InspectionService`: quando arriverà l'archivio cloud dovrà superare esattamente questa suite.
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IMediaStorage } from '@/services/interfaces/IMediaStorage';
import { MediaStorageMock } from '@/services/mocks/MediaStorageMock';
import { MediaStorageLocalDisk } from '@/services/real/MediaStorageLocalDisk';
import { NoopLogger } from '@/services/mocks/ConsoleLogger';
import { SequentialIdGenerator } from '@/services/mocks/SequentialIdGenerator';

const CHIAVE = '2026-09-11/F003/media-1.jpg';
const FOTO = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

/** Prove valide per qualunque implementazione della porta. */
export function mediaStorageContract(nome: string, make: () => IMediaStorage): void {
  describe(`IMediaStorage · ${nome}`, () => {
    it('salva, rilegge gli stessi byte e restituisce un indirizzo di lettura', async () => {
      const storage = make();
      const salvata = await storage.put({ key: CHIAVE, bytes: FOTO, mimeType: 'image/jpeg' });
      expect(salvata.ok).toBe(true);
      if (!salvata.ok) {
        return;
      }
      expect(salvata.value.url).toBe(storage.getUrl(salvata.value.key));

      const letta = await storage.read(salvata.value.key);
      expect(letta.ok).toBe(true);
      if (letta.ok) {
        expect(Array.from(letta.value.bytes)).toEqual(Array.from(FOTO));
        expect(letta.value.mimeType).toBe('image/jpeg');
      }
    });

    it('una chiave mai salvata non viene trovata', async () => {
      const storage = make();
      const letta = await storage.read('2026-09-11/F999/assente.jpg');
      expect(letta.ok).toBe(false);
      if (!letta.ok) {
        expect(letta.error.code).toBe('NOT_FOUND');
      }
    });

    it('riscrivere la stessa chiave sostituisce il contenuto', async () => {
      const storage = make();
      await storage.put({ key: CHIAVE, bytes: FOTO, mimeType: 'image/jpeg' });
      const nuova = new Uint8Array([9, 9, 9]);
      await storage.put({ key: CHIAVE, bytes: nuova, mimeType: 'image/jpeg' });

      const letta = await storage.read(CHIAVE);
      expect(letta.ok).toBe(true);
      if (letta.ok) {
        expect(Array.from(letta.value.bytes)).toEqual([9, 9, 9]);
      }
    });

    it('eliminare toglie il file; una seconda eliminazione è NOT_FOUND', async () => {
      const storage = make();
      await storage.put({ key: CHIAVE, bytes: FOTO, mimeType: 'image/jpeg' });

      expect((await storage.delete(CHIAVE)).ok).toBe(true);
      expect((await storage.read(CHIAVE)).ok).toBe(false);
      const seconda = await storage.delete(CHIAVE);
      expect(seconda.ok).toBe(false);
      if (!seconda.ok) {
        expect(seconda.error.code).toBe('NOT_FOUND');
      }
    });

    it('una chiave vuota è rifiutata come errore di validazione', async () => {
      const storage = make();
      const r = await storage.put({ key: '   ', bytes: FOTO, mimeType: 'image/jpeg' });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe('VALIDATION');
      }
    });
  });
}

mediaStorageContract(
  'memoria (mock)',
  () => new MediaStorageMock({ latencyMs: 0 }, { logger: new NoopLogger() }),
);

// Cartella temporanea creata alla raccolta dei test (le suite si registrano prima di `beforeAll`)
// e rimossa alla fine: i test non lasciano file in giro né dipendono da `.data/` del progetto.
const baseDir = mkdtempSync(join(tmpdir(), 'accettazione-media-'));
const make = (): MediaStorageLocalDisk =>
  new MediaStorageLocalDisk(
    { baseDir },
    { ids: new SequentialIdGenerator('tmp'), logger: new NoopLogger() },
  );

mediaStorageContract('disco locale', make);

describe('MediaStorageLocalDisk: comportamenti propri del disco', () => {
  afterAll(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('scrive davvero il file sotto la cartella base, con il percorso della chiave', async () => {
    const storage = make();
    const salvata = await storage.put({
      key: '2026-09-11/F007/foto-1.jpg',
      bytes: FOTO,
      mimeType: 'image/jpeg',
    });
    expect(salvata.ok).toBe(true);

    const suDisco = await readFile(join(baseDir, '2026-09-11', 'F007', 'foto-1.jpg'));
    expect(Array.from(new Uint8Array(suDisco))).toEqual(Array.from(FOTO));
  });

  it('le foto sopravvivono al riavvio: una nuova istanza rilegge la stessa cartella', async () => {
    await make().put({ key: '2026-09-11/F008/foto-1.jpg', bytes: FOTO, mimeType: 'image/jpeg' });

    const dopoRiavvio = await make().read('2026-09-11/F008/foto-1.jpg');
    expect(dopoRiavvio.ok).toBe(true);
  });

  it('la chiave riceve l’estensione del proprio tipo quando non ce l’ha', async () => {
    const salvata = await make().put({
      key: '2026-09-11/F009/senza-estensione',
      bytes: FOTO,
      mimeType: 'image/png',
    });
    expect(salvata.ok).toBe(true);
    if (salvata.ok) {
      expect(salvata.value.key).toBe('2026-09-11/F009/senza-estensione.png');
      const letta = await make().read(salvata.value.key);
      expect(letta.ok && letta.value.mimeType).toBe('image/png');
    }
  });

  it('nessuna chiave può uscire dalla cartella base', async () => {
    const storage = make();
    for (const chiave of [
      '../fuori.jpg',
      '2026-09-11/../../fuori.jpg',
      '/etc/passwd',
      'C:\\x.jpg',
    ]) {
      const r = await storage.put({ key: chiave, bytes: FOTO, mimeType: 'image/jpeg' });
      expect(r.ok, `chiave accettata per errore: ${chiave}`).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe('VALIDATION');
      }
    }
  });
});
