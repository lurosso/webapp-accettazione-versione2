// Sicurezza API al livello del proxy: sessione assente → 401/redirect, richieste cross-site →
// 403 prima ancora della sessione, CSP con nonce su ogni risposta, webhook esclusi dal controllo
// di origine. Il proxy gira senza container: qui si prova esattamente quello che vede il server
// prima di qualunque Route Handler.
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { proxy } from '@/proxy';

const ORIGINE = 'http://officina.local';

type Init = ConstructorParameters<typeof NextRequest>[1];

function richiesta(path: string, init?: Init): NextRequest {
  return new NextRequest(`${ORIGINE}${path}`, init);
}

describe('Sicurezza API: proxy', () => {
  it('senza cookie le API protette rispondono 401 e le pagine protette rimandano al login', async () => {
    const api = await proxy(richiesta('/api/v1/admin/operators'));
    expect(api.status).toBe(401);
    expect((await api.json()).error.code).toBe('UNAUTHORIZED');

    for (const pagina of ['/admin', '/accettazione/archivio', '/check-in', '/comunicazioni']) {
      const r = await proxy(richiesta(pagina));
      expect(r.status).toBe(307);
      expect(r.headers.get('location')).toContain('/login?next=');
    }
  });

  it('un cookie manomesso vale come assente', async () => {
    const r = await proxy(
      richiesta('/api/v1/queue', { headers: { cookie: 'accettazione_session=abc.def.ghi' } }),
    );
    expect(r.status).toBe(401);
  });

  it('rotte pubbliche e pagine aperte passano, ma con la Content-Security-Policy addosso', async () => {
    for (const path of [
      '/api/v1/public/status?targa=AB123CD',
      '/api/v1/health',
      '/login',
      '/cliente',
      '/display/A',
    ]) {
      const r = await proxy(richiesta(path));
      expect(r.status).toBe(200);
      expect(r.headers.get('x-middleware-next')).toBe('1');
      const csp = r.headers.get('content-security-policy') ?? '';
      expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/]+=*' 'strict-dynamic'/);
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'self'");
      expect(csp).not.toContain('upgrade-insecure-requests');
    }
  });

  it('il nonce cambia a ogni richiesta e viene passato al rendering', async () => {
    const a = await proxy(richiesta('/login'));
    const b = await proxy(richiesta('/login'));
    const nonceDi = (r: Response) =>
      /'nonce-([^']+)'/.exec(r.headers.get('content-security-policy') ?? '')?.[1] ?? null;
    expect(nonceDi(a)).not.toBeNull();
    expect(nonceDi(a)).not.toBe(nonceDi(b));
    // Next inoltra le intestazioni riscritte della richiesta con il prefisso x-middleware-request-.
    expect(a.headers.get('x-middleware-request-x-nonce')).toBe(nonceDi(a));
  });

  it('un POST dichiarato cross-site su un’API è rifiutato prima della sessione (CSRF)', async () => {
    const cross = await proxy(
      richiesta('/api/v1/appointments/x/actions', {
        method: 'POST',
        headers: { 'sec-fetch-site': 'cross-site', cookie: 'accettazione_session=qualunque' },
      }),
    );
    expect(cross.status).toBe(403);
    expect((await cross.json()).error.code).toBe('FORBIDDEN');

    const origineEstranea = await proxy(
      richiesta('/api/v1/appointments/x/actions', {
        method: 'POST',
        headers: { origin: 'https://evil.example', host: 'officina.local' },
      }),
    );
    expect(origineEstranea.status).toBe(403);

    // Stessa origine, senza cookie: il controllo di origine passa e si arriva alla sessione (401).
    const stessaOrigine = await proxy(
      richiesta('/api/v1/appointments/x/actions', {
        method: 'POST',
        headers: { 'sec-fetch-site': 'same-origin', origin: ORIGINE, host: 'officina.local' },
      }),
    );
    expect(stessaOrigine.status).toBe(401);
  });

  it('vale anche per le API pubbliche che scrivono, non per i webhook server-to-server', async () => {
    const arrivo = await proxy(
      richiesta('/api/v1/public/arrival', {
        method: 'POST',
        headers: { 'sec-fetch-site': 'cross-site' },
      }),
    );
    expect(arrivo.status).toBe(403);

    const webhook = await proxy(
      richiesta('/api/v1/webhooks/spoki', {
        method: 'POST',
        headers: { 'sec-fetch-site': 'cross-site' },
      }),
    );
    expect(webhook.headers.get('x-middleware-next')).toBe('1');
  });

  it('un correlation id fuori forma non viene propagato: se ne genera uno nuovo', async () => {
    const r = await proxy(
      richiesta('/api/v1/health', { headers: { 'x-correlation-id': 'a'.repeat(500) } }),
    );
    const propagato = r.headers.get('x-middleware-request-x-correlation-id') ?? '';
    expect(propagato).not.toBe('a'.repeat(500));
    expect(propagato).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('HSTS non compare fuori dalla produzione (in officina la LAN è in HTTP)', async () => {
    const r = await proxy(richiesta('/login'));
    expect(r.headers.get('strict-transport-security')).toBeNull();
  });
});
