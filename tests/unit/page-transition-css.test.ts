// La transizione di pagina e il campo data su iOS vivono come CSS esplicito in `globals.css`:
// questo test impedisce che tornino dentro il tema (dove WebKit non le vedeva bene) o che
// «Riduci movimento» le azzeri del tutto.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/app/globals.css', import.meta.url), 'utf8');

describe('globals.css: transizione di pagina e campo data', () => {
  it('la transizione è una classe piena con @keyframes espliciti, non una variabile del tema', () => {
    expect(css).not.toContain('--animate-entra-pagina');
    expect(css).toMatch(/@keyframes entra-pagina \{[\s\S]*?opacity: 0;[\s\S]*?translateY\(6px\)/);
    expect(css).toMatch(/\.animate-entra-pagina \{\s*animation: entra-pagina 200ms ease-out both;/);
  });

  it('con «Riduci movimento» il cambio di pagina resta una dissolvenza, non un salto secco', () => {
    const blocco =
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.animate-entra-pagina \{([\s\S]*?)\}/.exec(
        css,
      );
    expect(blocco).not.toBeNull();
    expect(blocco?.[1]).toContain('entra-pagina-dissolvenza 200ms ease-out both !important');
    expect(css).toMatch(
      /@keyframes entra-pagina-dissolvenza \{[\s\S]*?opacity: 0;[\s\S]*?opacity: 1;/,
    );
  });

  it('il campo data perde l’aspetto nativo di WebKit e ha altezza e valore allineati', () => {
    const regola = /input\[type='date'\] \{([\s\S]*?)\}/.exec(css)?.[1] ?? '';
    expect(regola).toContain('-webkit-appearance: none');
    expect(regola).toContain('height: 100%');
    expect(regola).toContain('width: 100%');
    const valore =
      /input\[type='date'\]::-webkit-date-and-time-value \{([\s\S]*?)\}/.exec(css)?.[1] ?? '';
    expect(valore).toContain('text-align: left');
    expect(valore).toContain('margin: auto 0');
    expect(valore).toContain('min-height: 1.5em');
  });
});
