import { describe, expect, it } from 'vitest';
import { lastDigits, parsePhoneE164, type PhoneE164 } from '@/domain/value-objects/phone';
import { isItalianPlate, normalizePlate, parsePlate } from '@/domain/value-objects/plate';

describe('plate', () => {
  it('accetta il formato italiano e normalizza spazi, trattini e minuscole', () => {
    const r = parsePlate(' ab 123-cd ');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe('AB123CD');
      expect(isItalianPlate(r.value)).toBe(true);
    }
  });

  it('accetta formati UE alfanumerici da 4 a 9 caratteri', () => {
    const r = parsePlate('W-XY 1234');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(isItalianPlate(r.value)).toBe(false);
    }
  });

  it('rifiuta targhe vuote o troppo corte', () => {
    expect(parsePlate('').ok).toBe(false);
    const short = parsePlate('AB1');
    expect(short.ok).toBe(false);
    if (!short.ok) {
      expect(short.error.code).toBe('VALIDATION');
    }
    expect(normalizePlate('a.b-c d')).toBe('ABCD');
  });
});

describe('phone', () => {
  it('normalizza il formato nazionale con prefisso +39', () => {
    const r = parsePhoneE164('333 123.45-60');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe('+393331234560');
    }
  });

  it('converte il prefisso 00 in +', () => {
    const r = parsePhoneE164('0039 333 1234560');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe('+393331234560');
    }
  });

  it('rifiuta numeri vuoti o non E.164', () => {
    expect(parsePhoneE164('').ok).toBe(false);
    expect(parsePhoneE164('+0123').ok).toBe(false);
    expect(parsePhoneE164('abc').ok).toBe(false);
  });

  it('lastDigits restituisce le ultime n cifre', () => {
    expect(lastDigits('+393331234599' as PhoneE164, 2)).toBe('99');
  });
});
