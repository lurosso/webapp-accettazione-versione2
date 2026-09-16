import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AREE,
  mappa,
  README_FINE,
  README_INIZIO,
  renderConsole,
  renderMarkdown,
  ROTTE,
} from '../../scripts/mappa-rotte.mjs';

const RADICE = resolve(__dirname, '..', '..');

/** Confronto insensibile all'allineamento delle tabelle (Prettier ripadda le colonne). */
function normalizza(s: string): string {
  return s
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((r) => r.replace(/\s+\|/g, '|').replace(/\|\s+/g, '|').replace(/\s+$/g, ''))
    .filter((r) => r !== '')
    .join('\n');
}

describe('Mappa delle rotte (scripts/mappa-rotte.mjs)', () => {
  const m = mappa(resolve(RADICE, 'src', 'app'));

  it('ogni pagina e ogni Route Handler di src/app ha una descrizione e un livello di accesso', () => {
    expect(m.senzaDescrizione).toEqual([]);
    expect(m.stantie).toEqual([]);
    expect(m.righe.length).toBe(ROTTE.length);
    for (const r of m.righe) {
      expect(r.descrizione.length).toBeGreaterThan(10);
      expect(r.accesso.length).toBeGreaterThan(5);
      expect(AREE).toContain(r.area);
      expect(r.methods.length).toBeGreaterThan(0);
    }
  });

  it('riconosce pagine, parametri dinamici e metodi HTTP', () => {
    const byPath = new Map(m.righe.map((r) => [r.path, r]));
    expect(byPath.get('/accettazione')?.kind).toBe('page');
    expect(byPath.get('/display/:campata')?.kind).toBe('page');
    expect(byPath.get('/api/v1/appointments/:id/media')?.methods).toEqual(['GET', 'POST']);
    expect(byPath.get('/api/v1/admin/operators/:id')?.methods).toEqual(['PATCH']);
    expect(byPath.get('/api/v1/sync')?.methods).toEqual(['POST']);
    expect(byPath.get('/api/v1/health')?.accesso).toBe('Pubblico');
    expect(byPath.get('/admin')?.accesso).toBe('Solo Amministratore');
  });

  it('la sezione del README coincide con la mappa generata (npm run rotte -- --readme)', () => {
    const readme = readFileSync(resolve(RADICE, 'README.md'), 'utf8');
    const inizio = readme.indexOf(README_INIZIO);
    const fine = readme.indexOf(README_FINE);
    expect(inizio).toBeGreaterThan(-1);
    expect(fine).toBeGreaterThan(inizio);
    const sezione = readme.slice(inizio + README_INIZIO.length, fine);
    expect(normalizza(sezione)).toBe(normalizza(renderMarkdown(m)));
  });

  it('la stampa a console elenca tutte le rotte per area', () => {
    const testo = renderConsole(m);
    for (const area of AREE) {
      expect(testo).toContain(`== ${area}`);
    }
    expect(testo).toContain('/api/v1/system/cron/reminders');
    expect(testo).toContain(`${ROTTE.length} rotte descritte.`);
  });
});
