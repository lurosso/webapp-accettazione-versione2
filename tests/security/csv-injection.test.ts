// Report CSV: una cella che Excel leggerebbe come formula viene neutralizzata.
import { describe, expect, it } from 'vitest';
import { csvCell } from '@/application/reporting/DailyReportService';

describe('Sicurezza: iniezione di formule nel CSV', () => {
  it('neutralizza =, @, tabulazione e ritorno a capo in testa alla cella', () => {
    expect(csvCell('=HYPERLINK("http://evil.example";"Rossi")')).toBe(
      `"'=HYPERLINK(""http://evil.example"";""Rossi"")"`,
    );
    expect(csvCell("=cmd|' /C calc'!A0")).toBe(`'=cmd|' /C calc'!A0`);
    expect(csvCell('@SUM(1;2)')).toBe(`"'@SUM(1;2)"`);
    expect(csvCell('\t=1+1')).toBe(`'\t=1+1`);
    expect(csvCell('\r=1+1')).toBe(`"'\r=1+1"`);
  });

  it('+ e - aprono una formula solo se il resto non è un numero o un telefono', () => {
    expect(csvCell('+39 333 1234567')).toBe('+39 333 1234567');
    expect(csvCell('-12.5')).toBe('-12.5');
    expect(csvCell('+39 (080) 123-4567')).toBe('+39 (080) 123-4567');
    expect(csvCell("-2+3+cmd|' /C calc'!A0")).toBe(`'-2+3+cmd|' /C calc'!A0`);
    expect(csvCell('+HYPERLINK("x")')).toBe(`"'+HYPERLINK(""x"")"`);
  });

  it('testi normali, numeri e valori assenti restano com’erano', () => {
    expect(csvCell('Rossi Mario')).toBe('Rossi Mario');
    expect(csvCell(42)).toBe('42');
    expect(csvCell(null)).toBe('');
    expect(csvCell('Graffio; paraurti "posteriore"')).toBe('"Graffio; paraurti ""posteriore"""');
  });
});
