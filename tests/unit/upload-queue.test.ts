// Coda dei caricamenti del tablet: nessuna foto o video si perde se la rete cade. Tempo, rete,
// archivio e invio sono finti e comandati dal test, così si prova la logica senza browser.
import { describe, expect, it } from 'vitest';
import type { InspectionPhoto } from '@/lib/api-client/client';
import {
  classifyUploadFailure,
  MemoryUploadStore,
  newUploadId,
  retryDelayMs,
  UploadQueue,
  type PendingUpload,
  type UploadAttemptResult,
} from '@/modules/inspection-media/upload-queue';

const media = (id: string): InspectionPhoto => ({
  id,
  url: `/api/v1/media/${id}.jpg`,
  kind: 'PHOTO',
  mimeType: 'image/jpeg',
  capturedAt: '2026-09-23T08:00:00.000Z',
  sizeBytes: 3,
  category: 'EXTRA',
  archivedAt: null,
});

/** Lascia girare le promesse della coda (un invio, il salvataggio nell'archivio, il timer). */
async function assesta(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

function ambiente(risposte: UploadAttemptResult[] = []) {
  let adesso = 1_000_000;
  let online = true;
  const timer: { at: number; fn: () => void }[] = [];
  const store = new MemoryUploadStore();
  const inviati: PendingUpload[] = [];
  const progressi: number[] = [];
  let n = 0;
  const queue = new UploadQueue({
    store,
    upload: async (u, onProgress) => {
      inviati.push(u);
      onProgress(0.5);
      progressi.push(queue.snapshot().find((x) => x.id === u.id)?.progress ?? -1);
      return risposte.shift() ?? { ok: true, media: media(`m-${u.id}`) };
    },
    now: () => adesso,
    isOnline: () => online,
    setTimer: (fn, ms) => {
      const t = { at: adesso + ms, fn };
      timer.push(t);
      return t;
    },
    clearTimer: (h) => {
      const i = timer.indexOf(h as (typeof timer)[number]);
      if (i >= 0) {
        timer.splice(i, 1);
      }
    },
    newId: () => `up-${(n += 1)}`,
  });
  const salvati: string[] = [];
  queue.onUploaded((appointmentId, m) => salvati.push(`${appointmentId}:${m.id}`));
  return {
    queue,
    store,
    inviati,
    progressi,
    salvati,
    setOnline: (v: boolean) => {
      online = v;
    },
    /** Fa passare il tempo e scatta i timer scaduti. */
    avanza: async (ms: number) => {
      adesso += ms;
      for (const t of timer.filter((x) => x.at <= adesso)) {
        timer.splice(timer.indexOf(t), 1);
        t.fn();
      }
      await assesta();
    },
    adesso: () => adesso,
  };
}

const foto = () => ({
  appointmentId: 'apt-1',
  blob: new Blob(['abc'], { type: 'image/jpeg' }),
  fileName: 'IMG_0001.jpg',
  category: 'EXTRA' as const,
  kind: 'PHOTO' as const,
});

describe('Classificazione dei fallimenti e attese', () => {
  it('rete assente, timeout e 5xx si riprovano; 401 aspetta l’accesso; i rifiuti si fermano', () => {
    for (const s of [null, 0, 408, 425, 429, 500, 502, 503, 504]) {
      expect(classifyUploadFailure(s)).toBe('retry');
    }
    expect(classifyUploadFailure(401)).toBe('auth');
    for (const s of [400, 403, 404, 409, 413, 415, 422]) {
      expect(classifyUploadFailure(s)).toBe('permanent');
    }
  });

  it('l’attesa cresce 2, 4, 8, 16, 32 secondi e poi resta a 60', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(retryDelayMs)).toEqual([
      2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000,
    ]);
  });

  it('l’id del caricamento ha la forma che il server accetta, anche senza randomUUID', () => {
    expect(newUploadId()).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    const originale = globalThis.crypto.randomUUID;
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      value: undefined,
      configurable: true,
    });
    try {
      const id = newUploadId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally {
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        value: originale,
        configurable: true,
      });
    }
  });
});

describe('UploadQueue', () => {
  it('un file va prima nell’archivio del tablet, poi parte; salvato, sparisce e lo si annuncia', async () => {
    const e = ambiente();
    const id = await e.queue.enqueue(foto());
    await assesta();
    expect(e.inviati.map((u) => u.id)).toEqual([id]);
    expect(e.progressi).toEqual([0.5]);
    expect(e.queue.snapshot()).toEqual([]);
    expect(await e.store.list()).toEqual([]);
    expect(e.salvati).toEqual([`apt-1:m-${id}`]);
  });

  it('rete caduta: il file resta sul tablet, aspetta e riparte da solo con lo stesso id', async () => {
    const e = ambiente([{ ok: false, status: null, message: 'Rete non raggiungibile.' }]);
    const id = await e.queue.enqueue(foto());
    await assesta();
    const [inAttesa] = e.queue.snapshot();
    expect(inAttesa?.status).toBe('WAITING_NETWORK');
    expect(inAttesa?.nextAttemptAt).toBe(e.adesso() + 2_000);
    expect((await e.store.list()).map((u) => u.id)).toEqual([id]);

    await e.avanza(1_000);
    expect(e.inviati).toHaveLength(1);
    await e.avanza(1_000);
    expect(e.inviati.map((u) => u.id)).toEqual([id, id]);
    expect(e.queue.snapshot()).toEqual([]);
  });

  it('offline non si tenta niente; quando la rete torna parte subito', async () => {
    const e = ambiente();
    e.setOnline(false);
    await e.queue.enqueue(foto());
    await assesta();
    expect(e.inviati).toHaveLength(0);
    expect(e.queue.snapshot()[0]?.status).toBe('QUEUED');

    e.setOnline(true);
    e.queue.networkBack();
    await assesta();
    expect(e.inviati).toHaveLength(1);
    expect(e.queue.snapshot()).toEqual([]);
  });

  it('un rifiuto del server si ferma: niente riprove da sole; «Riprova» riparte, «Scarta» cancella', async () => {
    const e = ambiente([
      { ok: false, status: 413, message: 'File troppo grande.' },
      { ok: false, status: 409, message: 'Check-in già chiuso.' },
    ]);
    const id = await e.queue.enqueue(foto());
    await assesta();
    expect(e.queue.snapshot()[0]).toMatchObject({
      status: 'FAILED',
      lastError: 'File troppo grande.',
    });
    await e.avanza(10 * 60_000);
    expect(e.inviati).toHaveLength(1);

    e.queue.retryNow(id);
    await assesta();
    expect(e.inviati).toHaveLength(2);
    expect(e.queue.snapshot()[0]?.status).toBe('FAILED');

    await e.queue.discard(id);
    expect(e.queue.snapshot()).toEqual([]);
    expect(await e.store.list()).toEqual([]);
  });

  it('sessione scaduta (401): il file aspetta un minuto o il ritorno in primo piano', async () => {
    const e = ambiente([{ ok: false, status: 401, message: 'Sessione scaduta.' }]);
    await e.queue.enqueue(foto());
    await assesta();
    expect(e.queue.snapshot()[0]?.status).toBe('WAITING_AUTH');
    expect(e.queue.snapshot()[0]?.nextAttemptAt).toBe(e.adesso() + 60_000);
    e.queue.networkBack();
    await assesta();
    expect(e.inviati).toHaveLength(2);
    expect(e.queue.snapshot()).toEqual([]);
  });

  it('riaprendo la pagina riparte quello che era rimasto sul tablet, anche se era a metà invio', async () => {
    const e = ambiente();
    const blob = new Blob(['xyz'], { type: 'video/mp4' });
    await e.store.put({
      id: 'rimasto-1',
      appointmentId: 'apt-9',
      category: null,
      kind: 'VIDEO',
      fileName: 'giro.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 3,
      blob,
      createdAt: 1,
      attempts: 1,
      status: 'UPLOADING',
      nextAttemptAt: null,
      progress: 0.7,
      lastError: null,
    });
    await e.queue.init();
    await assesta();
    expect(e.inviati.map((u) => u.id)).toEqual(['rimasto-1']);
    expect(e.salvati).toEqual(['apt-9:m-rimasto-1']);
    expect(await e.store.list()).toEqual([]);
  });

  it('i file partono uno alla volta, dal più vecchio', async () => {
    const e = ambiente();
    e.setOnline(false);
    const a = await e.queue.enqueue(foto());
    await e.avanza(10);
    const b = await e.queue.enqueue({ ...foto(), appointmentId: 'apt-2' });
    e.setOnline(true);
    e.queue.networkBack();
    await assesta();
    expect(e.inviati.map((u) => u.id)).toEqual([a, b]);
  });
});
