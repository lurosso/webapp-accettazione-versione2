// Configurazione Next.js.
// `output: 'standalone'` produce un bundle server autonomo: l'app va eseguita come UNICO processo
// Node long-running (Docker/VM/servizio Windows), mai serverless, perché in fase mock lo stato
// della coda vive in memoria nel processo (InMemoryStore su globalThis, vedi ARCHITECTURE.md §6.1).
import type { NextConfig } from 'next';

/**
 * Intestazioni di sicurezza su ogni risposta. Niente Content-Security-Policy per ora: richiede i
 * nonce sugli script inline di Next e va introdotta con una fase di sola segnalazione (report-only),
 * altrimenti spegne le pagine il primo giorno. La fotocamera resta consentita alla stessa origine:
 * è quella che il tablet usa per le foto del veicolo.
 */
const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // Il driver ODBC è un modulo nativo (binario .node): resta fuori dal bundle e viene richiesto a
  // runtime dal processo Node solo quando INFINITY_PROVIDER=real.
  serverExternalPackages: ['odbc'],
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
