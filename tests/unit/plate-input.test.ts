import { describe, expect, it } from 'vitest';
import {
  formatPlateInput,
  PLATE_MAX_LENGTH,
  plateErrorMessage,
} from '@/modules/customer-portal/plate-input';
import { aheadCountMessage, statusMessage } from '@/modules/customer-portal/status-messages';

describe('formatPlateInput', () => {
  it('porta in maiuscolo e rimuove spazi, trattini e punti mentre si digita', () => {
    expect(formatPlateInput(' ab 123-cd ')).toBe('AB123CD');
    expect(formatPlateInput('ef.456.gh')).toBe('EF456GH');
  });

  it('scarta i caratteri non alfanumerici e limita la lunghezza', () => {
    expect(formatPlateInput('AB*123#CD')).toBe('AB123CD');
    expect(formatPlateInput('ABCDEFGHIJKLM')).toHaveLength(PLATE_MAX_LENGTH);
  });
});

describe('plateErrorMessage', () => {
  it('campo vuoto e targa troppo corta hanno messaggi in italiano', () => {
    expect(plateErrorMessage('')).toContain('Inserisci');
    expect(plateErrorMessage('AB1')).toContain('non valida');
  });

  it('una targa valida non produce errori', () => {
    expect(plateErrorMessage('ab 123 cd')).toBeNull();
  });
});

describe('messaggi di stato del portale', () => {
  it('ogni stato ha titolo e dettaglio; il conteggio si mostra solo in coda', () => {
    expect(statusMessage('WAITING', null).showAheadCount).toBe(true);
    expect(statusMessage('SKIPPED', null).showAheadCount).toBe(true);
    expect(statusMessage('IN_PROGRESS', 3).detail).toContain('accettazione 3');
    expect(statusMessage('IN_PROGRESS', null).detail).toContain('corsia');
    expect(statusMessage('COMPLETED', null).tone).toBe('done');
    expect(statusMessage('NO_SHOW', null).tone).toBe('attention');
    expect(statusMessage('CANCELLED', null).showAheadCount).toBe(false);
  });

  it('il conteggio è scritto in italiano corretto al singolare e al plurale', () => {
    expect(aheadCountMessage(0)).toBe('Sei il prossimo');
    expect(aheadCountMessage(1)).toContain('1 cliente prima di te');
    expect(aheadCountMessage(4)).toContain('4 clienti prima di te');
  });
});
