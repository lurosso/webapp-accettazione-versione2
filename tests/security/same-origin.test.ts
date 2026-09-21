// Difesa CSRF: le richieste che cambiano stato devono partire dalla nostra origine.
import { describe, expect, it } from 'vitest';
import { crossSiteRequestReason } from '@/lib/http/same-origin';

describe("Sicurezza API: controllo dell'origine sulle richieste che cambiano stato", () => {
  it('GET e HEAD passano sempre, anche da un altro sito', () => {
    const h = new Headers({ 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' });
    expect(crossSiteRequestReason('GET', h)).toBeNull();
    expect(crossSiteRequestReason('HEAD', h)).toBeNull();
    expect(crossSiteRequestReason('OPTIONS', h)).toBeNull();
  });

  it('un POST dichiarato cross-site dal browser è rifiutato', () => {
    const h = new Headers({ 'sec-fetch-site': 'cross-site', host: 'officina.local' });
    expect(crossSiteRequestReason('POST', h)).toContain('cross-site');
    expect(crossSiteRequestReason('PATCH', h)).toContain('cross-site');
    expect(crossSiteRequestReason('DELETE', h)).toContain('cross-site');
  });

  it("un POST con Origin diversa dall'host che ci ha ricevuto è rifiutato", () => {
    const h = new Headers({ origin: 'https://evil.example', host: 'officina.local' });
    expect(crossSiteRequestReason('POST', h)).toContain('evil.example');
    expect(crossSiteRequestReason('POST', new Headers({ origin: 'null', host: 'a' }))).toBe(
      'Origin: null',
    );
    expect(
      crossSiteRequestReason('POST', new Headers({ origin: 'non-una-url', host: 'a' })),
    ).toContain('non valida');
  });

  it('la stessa origine passa: same-origin dichiarato, oppure Origin uguale a Host', () => {
    expect(
      crossSiteRequestReason(
        'POST',
        new Headers({
          'sec-fetch-site': 'same-origin',
          origin: 'http://10.50.193.83:3000',
          host: '10.50.193.83:3000',
        }),
      ),
    ).toBeNull();
    expect(
      crossSiteRequestReason(
        'POST',
        new Headers({ origin: 'http://Officina.Local', host: 'officina.local' }),
      ),
    ).toBeNull();
  });

  it("dietro un reverse proxy conta l'host inoltrato, non quello interno", () => {
    const h = new Headers({
      origin: 'https://accettazione.autoclub.it',
      host: '127.0.0.1:3000',
      'x-forwarded-host': 'accettazione.autoclub.it',
    });
    expect(crossSiteRequestReason('POST', h)).toBeNull();
  });

  it('senza intestazioni del browser (cron, webhook, curl) la richiesta passa', () => {
    expect(crossSiteRequestReason('POST', new Headers({ host: 'officina.local' }))).toBeNull();
  });
});
