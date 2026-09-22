// Archivio: il filtro «Solo con foto/video» toglie le schede senza file e non riordina; il
// conteggio racconta cosa si sta guardando.
import { describe, expect, it } from 'vitest';
import {
  archiveCountLabel,
  filterArchiveEntries,
  hasMedia,
} from '@/modules/inspection-media/archive-filter';

const conFoto = { code: 'F001', photos: [{ id: 'a' }] };
const conVideoArchiviato = { code: 'F002', photos: [{ id: 'b', archivedAt: '2026-09-01' }] };
const senza = { code: 'F003', photos: [] };

describe('Archivio: filtro «Solo con foto/video»', () => {
  it('spento mostra tutto, acceso solo le schede con almeno un file (anche archiviato)', () => {
    const tutte = [conFoto, senza, conVideoArchiviato];
    expect(filterArchiveEntries(tutte, false)).toBe(tutte);
    expect(filterArchiveEntries(tutte, true).map((e) => e.code)).toEqual(['F001', 'F002']);
    expect(hasMedia(senza)).toBe(false);
    expect(hasMedia(conVideoArchiviato)).toBe(true);
  });

  it('il conteggio dice quante schede si vedono e su quante', () => {
    expect(archiveCountLabel(12, 12, false)).toBe('12 pratiche');
    expect(archiveCountLabel(1, 1, false)).toBe('1 pratica');
    expect(archiveCountLabel(3, 12, true)).toBe('3 con foto/video su 12');
    expect(archiveCountLabel(0, 12, true)).toBe('0 con foto/video su 12');
  });
});
