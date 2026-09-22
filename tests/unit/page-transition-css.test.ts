// La transizione di pagina e il campo data su iOS vivono come CSS esplicito in `globals.css`:
// questo test impedisce che tornino dentro il tema o che «Riduci movimento» le azzeri del tutto.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/app/globals.css', import.meta.url), 'utf8');

function regola(selettore: string): string {
  const m = new RegExp(
    `${selettore.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([\\s\\S]*?)\\}`,
  ).exec(css);
  return m?.[1] ?? '';
}

describe('globals.css: transizione di pagina in tre fasi', () => {
  it('non è più una animation all’inserimento: sono stati scritti in data-fase e transizioni', () => {
    expect(css).not.toContain('--animate-entra-pagina');
    expect(css).not.toContain('.animate-entra-pagina');
    expect(regola(".transizione-pagina[data-fase='entrata']")).toContain('opacity: 0');
    expect(regola(".transizione-pagina[data-fase='visibile']")).toContain('opacity: 1');
    expect(regola(".transizione-pagina[data-fase='visibile']")).toMatch(
      /transition:\s*opacity 240ms ease-out/,
    );
    expect(regola(".transizione-pagina[data-fase='uscita']")).toMatch(/opacity: 0\.\d+/);
  });

  it('nello stato visibile il contenitore non ha trasformazioni: gli elementi fixed restano al loro posto', () => {
    expect(regola(".transizione-pagina[data-fase='visibile']")).toContain('transform: none');
    expect(regola(".transizione-pagina[data-fase='entrata']")).toContain(
      'will-change: opacity, transform',
    );
  });

  it('con «Riduci movimento» il cambio di pagina resta una dissolvenza, non un salto secco', () => {
    const blocco =
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.transizione-pagina\[data-fase='entrata'\][\s\S]*?\n\}/.exec(
        css,
      )?.[0] ?? '';
    expect(blocco).toContain('transform: none');
    expect(blocco).toContain('transition: opacity 240ms ease-out !important');
    expect(blocco).toContain('transition: opacity 140ms ease-in !important');
  });
});

describe('globals.css: campo data su iOS Safari', () => {
  it('perde l’aspetto nativo di WebKit e ha altezza e valore allineati', () => {
    const campo = regola("input[type='date']");
    expect(campo).toContain('-webkit-appearance: none');
    expect(campo).toContain('height: 100%');
    expect(campo).toContain('width: 100%');
    const valore = regola("input[type='date']::-webkit-date-and-time-value");
    expect(valore).toContain('text-align: left');
    expect(valore).toContain('margin: auto 0');
    expect(valore).toContain('min-height: 1.5em');
  });
});
