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
    expect(plateErrorMessage('')).toContain('Inserisca');
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
    // Il cliente aspetta in auto, in fila: i testi lo dicono.
    expect(statusMessage('WAITING', null).headline).toBe('È in fila');
    expect(statusMessage('WAITING', null).detail).toContain('in auto');
    expect(statusMessage('IN_PROGRESS', 'A').detail).toContain('Si presenti allo sportello A');
    expect(statusMessage('IN_PROGRESS', null).detail).toContain('accettazione');
    expect(statusMessage('COMPLETED', null).tone).toBe('done');
    expect(statusMessage('NO_SHOW', null).tone).toBe('attention');
    expect(statusMessage('CANCELLED', null).showAheadCount).toBe(false);
  });

  it('il conteggio parla di auto in fila, al singolare e al plurale', () => {
    expect(aheadCountMessage(0)).toBe('Il prossimo turno è il suo');
    expect(aheadCountMessage(1)).toContain('1 auto prima di lei');
    expect(aheadCountMessage(4)).toContain('4 auto prima di lei');
  });
});
