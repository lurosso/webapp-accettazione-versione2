// Configurazione Next.js.
// `output: 'standalone'` produce un bundle server autonomo: l'app va eseguita come UNICO processo
// Node long-running (Docker/VM/servizio Windows), mai serverless, perché in fase mock lo stato
// della coda vive in memoria nel processo (InMemoryStore su globalThis, vedi ARCHITECTURE.md §6.1).
import type { NextConfig } from 'next';
import { devOrigins } from './src/config/dev-origins';

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
  // Il dev server accetta le proprie risorse (HMR, chunk) dagli indirizzi di questa macchina —
  // così l'iPad in Wi-Fi apre http://<ip-del-pc>:3000 e la pagina si idrata — più quelli in
  // ALLOWED_DEV_ORIGINS. Senza, la pagina arriva ma i pulsanti non fanno niente e il login non
  // parte mai. Solo sviluppo: in produzione l'opzione è ignorata.
  allowedDevOrigins: [...devOrigins()],
  // Il driver ODBC è un modulo nativo (binario .node): resta fuori dal bundle e viene richiesto a
  // runtime dal processo Node solo quando INFINITY_PROVIDER=real.
  // Stessa cosa per SQLite: `better-sqlite3` è nativo e l'adapter Prisma lo richiede a runtime.
  serverExternalPackages: ['odbc', 'better-sqlite3', '@prisma/adapter-better-sqlite3'],
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
