// Configurazione Next.js.
// `output: 'standalone'` produce un bundle server autonomo: l'app va eseguita come UNICO processo
// Node long-running (Docker/VM/servizio Windows), mai serverless, perché in fase mock lo stato
// della coda vive in memoria nel processo (InMemoryStore su globalThis, vedi ARCHITECTURE.md §6.1).
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
};

export default nextConfig;
