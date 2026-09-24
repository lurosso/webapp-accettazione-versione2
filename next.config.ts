// Configurazione Next.js.
// `output: 'standalone'` produce un bundle server autonomo: l'app va eseguita come UNICO processo
// Node long-running (Docker/VM/servizio Windows), mai serverless, perché in fase mock lo stato
// della coda vive in memoria nel processo (InMemoryStore su globalThis, vedi ARCHITECTURE.md §6.1).
import type { NextConfig } from 'next';
import { devOrigins } from './src/config/dev-origins';
import { PROXY_CLIENT_MAX_BODY_BYTES } from './src/config/request-limits';

/**
 * Intestazioni di sicurezza fisse su ogni risposta. La Content-Security-Policy NON sta qui: ha
 * bisogno di un nonce diverso per richiesta e la costruisce il proxy (`src/proxy.ts`, con
 * `lib/http/security-headers.ts`). La fotocamera resta consentita alla stessa origine: è quella
 * che il tablet usa per le foto del veicolo. HSTS solo in produzione, dove l'app sta dietro TLS:
 * in officina la LAN è in HTTP e i browser lo ignorano comunque finché la pagina non arriva in HTTPS.
 */
const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ...(process.env.NODE_ENV === 'production'
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
    : []),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // Il dev server accetta le proprie risorse (HMR, chunk) dagli indirizzi di questa macchina e,
  // salvo ALLOWED_DEV_ORIGINS_LAN=false, da qualunque indirizzo di rete privata — così l'iPad in
  // Wi-Fi apre http://<ip-del-pc>:3000 e la pagina si idrata anche se il PC ha cambiato IP dopo
  // l'avvio — più i nomi in ALLOWED_DEV_ORIGINS. Senza, la pagina arriva ma i pulsanti non fanno
  // niente e il login non parte mai. Solo sviluppo: in produzione l'opzione è ignorata.
  allowedDevOrigins: [...devOrigins()],
  // Il driver ODBC è un modulo nativo (binario .node): resta fuori dal bundle e viene richiesto a
  // runtime dal processo Node solo quando INFINITY_PROVIDER=real.
  // Stessa cosa per SQLite: `better-sqlite3` è nativo e l'adapter Prisma lo richiede a runtime.
  serverExternalPackages: ['odbc', 'better-sqlite3', '@prisma/adapter-better-sqlite3'],
  experimental: {
    // Il proxy copia il corpo delle richieste fino a questa soglia e oltre TRONCA in silenzio: con i
    // 10 MB di default un video del check-in più grande arrivava monco alla rotta dei media.
    proxyClientMaxBodySize: PROXY_CLIENT_MAX_BODY_BYTES,
  },
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
