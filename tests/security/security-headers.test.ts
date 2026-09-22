// Intestazioni di sicurezza: la CSP è quella che ci si aspetta, con il nonce della richiesta.
import { describe, expect, it } from 'vitest';
import {
  buildContentSecurityPolicy,
  generateNonce,
  STATIC_SECURITY_HEADERS,
  STRICT_TRANSPORT_SECURITY,
  uploadedFileHeaders,
} from '@/lib/http/security-headers';

function direttive(csp: string): Map<string, string> {
  return new Map(
    csp.split(';').map((d) => {
      const [nome, ...valori] = d.trim().split(' ');
      return [nome ?? '', valori.join(' ')];
    }),
  );
}

describe('Sicurezza: Content-Security-Policy e intestazioni', () => {
  it('in produzione gli script partono solo con il nonce della richiesta', () => {
    const csp = direttive(buildContentSecurityPolicy({ nonce: 'abc123', dev: false }));
    expect(csp.get('script-src')).toBe("'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp.get('script-src')).not.toContain('unsafe-inline');
    expect(csp.get('script-src')).not.toContain('unsafe-eval');
    expect(csp.get('object-src')).toBe("'none'");
    expect(csp.get('base-uri')).toBe("'self'");
    expect(csp.get('frame-ancestors')).toBe("'self'");
    expect(csp.get('form-action')).toBe("'self'");
    expect(csp.get('connect-src')).toBe("'self'");
    expect(csp.get('default-src')).toBe("'self'");
  });

  it('anteprime foto e video (blob:) e miniature (data:) restano consentite', () => {
    const csp = direttive(buildContentSecurityPolicy({ nonce: 'n', dev: false }));
    expect(csp.get('img-src')).toContain('blob:');
    expect(csp.get('img-src')).toContain('data:');
    expect(csp.get('media-src')).toContain('blob:');
  });

  it('in sviluppo aggiunge solo ciò che serve a HMR e al debug di React', () => {
    const csp = direttive(buildContentSecurityPolicy({ nonce: 'n', dev: true }));
    expect(csp.get('script-src')).toContain("'unsafe-eval'");
    // Senza strict-dynamic: i chunk dell'HMR di Turbopack sono inseriti dal parser.
    expect(csp.get('script-src')).not.toContain('strict-dynamic');
    expect(csp.get('script-src')).toContain("'nonce-n'");
    expect(csp.get('connect-src')).toContain('ws:');
  });

  it('non forza il passaggio a HTTPS: in officina la LAN è in HTTP', () => {
    const csp = buildContentSecurityPolicy({ nonce: 'n', dev: false });
    expect(csp).not.toContain('upgrade-insecure-requests');
    expect(STRICT_TRANSPORT_SECURITY).toContain('max-age=31536000');
  });

  it('il nonce è casuale, in base64, e cambia a ogni richiesta', () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(a).not.toBe(b);
    expect(Buffer.from(a, 'base64')).toHaveLength(16);
  });

  it('le intestazioni fisse restano quelle di sempre più COOP', () => {
    expect(STATIC_SECURITY_HEADERS['x-content-type-options']).toBe('nosniff');
    expect(STATIC_SECURITY_HEADERS['x-frame-options']).toBe('SAMEORIGIN');
    expect(STATIC_SECURITY_HEADERS['permissions-policy']).toContain('camera=(self)');
    expect(STATIC_SECURITY_HEADERS['cross-origin-opener-policy']).toBe('same-origin');
  });

  it('un file caricato dagli utenti viene servito in sandbox, con nome ripulito', () => {
    const h = uploadedFileHeaders('image/jpeg', '2026-09-21/F001/front-<x>.jpg');
    expect(h['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(h['content-disposition']).toBe('inline; filename="2026-09-21_F001_front-_x_.jpg"');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['cache-control']).toContain('private');
  });
});
