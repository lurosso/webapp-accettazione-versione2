// Difesa dal CSRF per le API che cambiano stato, oltre a `SameSite=Lax` sul cookie.
//
// Il cookie con `SameSite=Lax` non viaggia sulle richieste POST avviate da un altro sito, ed è già
// una buona difesa. Qui se ne aggiunge una seconda, indipendente, che non dipende dal browser che
// rispetta l'attributo: i browser moderni dichiarano da dove parte una richiesta
// (`Sec-Fetch-Site`) e da quale origine (`Origin`). Una richiesta che cambia qualcosa e arriva
// dichiaratamente da un altro sito, o con un'origine diversa dall'host che ci ha ricevuto, viene
// rifiutata prima di toccare la sessione.
//
// Chi non è un browser (cron esterno, webhook, curl dell'amministratore) non manda nessuna delle
// due intestazioni e passa: la sua autenticazione è il segreto o la sessione, non l'origine.

/** Metodi che leggono soltanto: il controllo non si applica. */
const METODI_SICURI = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Host atteso, come lo vede il browser: quello inoltrato dal reverse proxy, altrimenti `Host`. */
function hostAtteso(headers: Headers): string | null {
  const inoltrato = headers.get('x-forwarded-host');
  if (inoltrato !== null && inoltrato.trim() !== '') {
    return (inoltrato.split(',')[0] ?? '').trim().toLowerCase();
  }
  const host = headers.get('host');
  return host === null || host.trim() === '' ? null : host.trim().toLowerCase();
}

/**
 * Motivo per cui la richiesta va rifiutata come cross-site, oppure `null` se può procedere.
 * Solo per metodi che cambiano stato; GET e HEAD passano sempre.
 */
export function crossSiteRequestReason(method: string, headers: Headers): string | null {
  if (METODI_SICURI.has(method.toUpperCase())) {
    return null;
  }
  const sito = headers.get('sec-fetch-site')?.trim().toLowerCase() ?? null;
  if (sito === 'cross-site') {
    return 'Sec-Fetch-Site: cross-site';
  }
  const origin = headers.get('origin')?.trim() ?? null;
  if (origin === null || origin === '') {
    return null;
  }
  if (origin.toLowerCase() === 'null') {
    return 'Origin: null';
  }
  let hostOrigine: string;
  try {
    hostOrigine = new URL(origin).host.toLowerCase();
  } catch {
    return `Origin non valida: ${origin}`;
  }
  const atteso = hostAtteso(headers);
  if (atteso !== null && hostOrigine !== atteso) {
    return `Origin ${hostOrigine} diversa dall'host ${atteso}`;
  }
  return null;
}
