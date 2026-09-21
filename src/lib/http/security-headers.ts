// Intestazioni di sicurezza costruite dal proxy, in un posto solo e senza dipendenze da Next, così
// si provano a parte.
//
// La Content-Security-Policy è la difesa di fondo contro l'XSS: anche se un testo ostile arrivasse
// nel DOM, senza il nonce della richiesta nessuno script parte. Il nonce cambia a ogni risposta;
// Next.js lo legge dall'intestazione della richiesta e lo mette da solo sui propri script (vedi
// la guida `content-security-policy.md`), il layout lo mette sull'unico script inline nostro.
//
// Scelte:
// - `style-src 'unsafe-inline'`: React scrive gli stili in attributo `style` (barre del report,
//   larghezza minima dello slider) e Tailwind li serve da file. Un'iniezione di CSS senza script
//   è un danno estetico; bloccare gli attributi `style` sui tablet più vecchi sarebbe un danno
//   operativo. Si stringe con `style-src-attr` quando il parco dispositivi lo permette.
// - `img-src`/`media-src blob:`: le anteprime di foto e video al check-in nascono da
//   `URL.createObjectURL`; `data:` per le miniature.
// - `frame-ancestors 'self'`: i monitor di sportello si possono incorniciare solo dalle nostre
//   pagine, come già dice `X-Frame-Options: SAMEORIGIN`.
// - niente `upgrade-insecure-requests`: in officina l'app gira anche in HTTP sulla LAN, e
//   un'istruzione a passare a HTTPS spegnerebbe i tablet. HSTS arriva solo in produzione, ed è
//   comunque ignorato dai browser finché la pagina non arriva in HTTPS.
// - in sviluppo `'unsafe-eval'` (React ricostruisce gli stack) e `ws:` (HMR), come da guida.

export interface CspOptions {
  /** Nonce base64 della richiesta: va su ogni script inline della risposta. */
  readonly nonce: string;
  /** Sviluppo: aggiunge le sorgenti che servono solo a Turbopack/HMR. */
  readonly dev: boolean;
}

/** La policy come stringa di intestazione (una riga, direttive separate da `;`). */
export function buildContentSecurityPolicy({ nonce, dev }: CspOptions): string {
  const direttive = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ];
  return direttive.join('; ');
}

/** Intestazioni fisse che accompagnano ogni risposta (le stesse di `next.config.ts`). */
export const STATIC_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(self), microphone=(), geolocation=()',
  'cross-origin-opener-policy': 'same-origin',
};

/** HSTS: un anno, sottodomini inclusi. Solo in produzione, dove l'app sta dietro TLS. */
export const STRICT_TRANSPORT_SECURITY = 'max-age=31536000; includeSubDomains';

/**
 * Intestazioni per servire un file caricato dagli utenti (foto e video del check-in). Il file
 * viene mostrato inline, ma in una sandbox senza alcuna sorgente: anche se il contenuto fosse
 * interpretabile come documento, non potrebbe eseguire nulla né leggere i cookie dell'origine.
 */
export function uploadedFileHeaders(mimeType: string, fileName: string): Record<string, string> {
  const nome = fileName.replace(/[^A-Za-z0-9._-]/g, '_');
  return {
    'content-type': mimeType,
    'content-disposition': `inline; filename="${nome}"`,
    'content-security-policy': "default-src 'none'; sandbox",
    'x-content-type-options': 'nosniff',
    // Materiale della pratica: non finisce nelle cache condivise.
    'cache-control': 'private, max-age=300',
  };
}

/** Nonce casuale per la richiesta (128 bit in base64). */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let binario = '';
  for (const b of bytes) {
    binario += String.fromCharCode(b);
  }
  return btoa(binario);
}
