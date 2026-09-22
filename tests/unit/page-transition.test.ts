// Transizione di pagina: lo store condiviso, la regola sui click da animare e il rendering
// iniziale (la prima pagina arriva visibile dal server, senza aspettare il JavaScript).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  azzeraUscita,
  clickDaAnimare,
  iscrivitiAllaTransizione,
  percorsoInUscitaCorrente,
  primaPaginaGiaMontata,
  resetTransizionePerTest,
  segnalaUscita,
  soloPercorso,
  USCITA_MASSIMA_MS,
} from '@/components/layout/page-transition-store';
import { PageTransition } from '@/components/layout/PageTransition';

afterEach(() => {
  resetTransizionePerTest();
  vi.useRealTimers();
});

describe('Transizione di pagina: store', () => {
  it('segnala la pagina in uscita, avvisa chi ascolta e si azzera quando la nuova è montata', () => {
    const avvisi: (string | null)[] = [];
    const stacca = iscrivitiAllaTransizione(() => avvisi.push(percorsoInUscitaCorrente()));
    segnalaUscita('/accettazione');
    expect(percorsoInUscitaCorrente()).toBe('/accettazione');
    azzeraUscita();
    expect(percorsoInUscitaCorrente()).toBeNull();
    expect(avvisi).toEqual(['/accettazione', null]);
    stacca();
    segnalaUscita('/check-in');
    expect(avvisi).toHaveLength(2);
  });

  it('se la navigazione non arriva, la pagina non resta sfumata: si azzera da sola', () => {
    vi.useFakeTimers();
    segnalaUscita('/accettazione');
    vi.advanceTimersByTime(USCITA_MASSIMA_MS - 1);
    expect(percorsoInUscitaCorrente()).toBe('/accettazione');
    vi.advanceTimersByTime(2);
    expect(percorsoInUscitaCorrente()).toBeNull();
  });

  it('il percorso si confronta senza query né hash: cambiare filtro nella stessa pagina non fa uscire', () => {
    expect(soloPercorso('/accettazione?deskId=desk-s1&view=desk')).toBe('/accettazione');
    expect(soloPercorso('/check-in#foto')).toBe('/check-in');
    expect(soloPercorso('/accettazione/archivio')).toBe('/accettazione/archivio');
  });
});

describe('Transizione di pagina: quali click animare', () => {
  it('il tocco normale sì; modificatori, tasto centrale, target esterni o click già gestiti no', () => {
    expect(clickDaAnimare({ button: 0 })).toBe(true);
    expect(clickDaAnimare({ button: 0 }, '_self')).toBe(true);
    expect(clickDaAnimare({ button: 1 })).toBe(false);
    expect(clickDaAnimare({ button: 0, metaKey: true })).toBe(false);
    expect(clickDaAnimare({ button: 0, ctrlKey: true })).toBe(false);
    expect(clickDaAnimare({ button: 0, shiftKey: true })).toBe(false);
    expect(clickDaAnimare({ button: 0, altKey: true })).toBe(false);
    expect(clickDaAnimare({ button: 0, defaultPrevented: true })).toBe(false);
    expect(clickDaAnimare({ button: 0 }, '_blank')).toBe(false);
  });
});

describe('Transizione di pagina: rendering iniziale', () => {
  it('la prima pagina arriva dal server già visibile, non trasparente in attesa del JavaScript', () => {
    expect(primaPaginaGiaMontata()).toBe(false);
    const html = renderToStaticMarkup(
      createElement(PageTransition, null, createElement('p', null, 'contenuto')),
    );
    expect(html).toContain('data-fase="visibile"');
    expect(html).toContain('class="transizione-pagina"');
    expect(html).toContain('contenuto');
  });
});
