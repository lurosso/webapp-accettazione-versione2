#!/usr/bin/env node
// Mappa completa delle rotte dell'applicazione: legge `src/app` (pagine e Route Handler di Next.js),
// ricava l'indirizzo pubblico di ognuna e la abbina alla descrizione e al livello di accesso
// dell'elenco curato qui sotto. Se una rotta nuova non è descritta, o una descritta non esiste più,
// lo dice ed esce con errore: il test tests/unit/mappa-rotte.test.ts fa lo stesso controllo.
//
//   npm run rotte              stampa la mappa a console, per area
//   npm run rotte -- --markdown  stampa la sezione in Markdown
//   npm run rotte -- --readme    riscrive la sezione del README fra i marcatori
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const METODI = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** Livelli di accesso, con la stessa dicitura ovunque. */
const ACCESSO = {
  pubblico: 'Pubblico',
  monitor: 'Pubblico · token del monitor (`?token=`, obbligatorio con DISPLAY_TOKEN_REQUIRED=true)',
  sessione: 'Sessione operatore (Accettatore, Manager, Amministratore)',
  sessioneProvvisoria: 'Sessione operatore, anche con password provvisoria',
  manager: 'Manager e Amministratore',
  admin: 'Solo Amministratore',
  cron: 'Amministratore oppure intestazione `x-cron-secret`',
};

/** Aree nell'ordine in cui compaiono in README e a console. */
export const AREE = [
  'Accesso e sessione',
  'Dashboard accettazione e postazioni operatore',
  'Tablet e check-in veicolo',
  'Manager e BDC',
  'Amministrazione e configurazione',
  'Sistema e diagnostica',
  'Display di sala e monitor delle campate',
  'Portale cliente (live tracking)',
  'API: autenticazione',
  'API: coda e pratiche',
  'API: pubbliche (portale cliente, monitor, tabellone)',
  'API: manager, report e BDC',
  'API: amministrazione',
  'API: sistema e cron',
];

/** Elenco curato: indirizzo → area, descrizione, accesso. I metodi HTTP si leggono dai file. */
export const ROTTE = [
  // Accesso e sessione
  {
    path: '/',
    area: AREE[0],
    descrizione:
      'Radice: smista alla home del ruolo (accettazione, manager, admin, tabellone per i kiosk) o al login.',
    accesso: ACCESSO.pubblico,
  },
  {
    path: '/login',
    area: AREE[0],
    descrizione:
      "Login dell'operatore: credenziali e scelta della postazione (Accettazione N · marchi serviti).",
    accesso: ACCESSO.pubblico,
  },
  {
    path: '/cambia-password',
    area: AREE[0],
    descrizione: 'Cambio password, obbligato dopo creazione account o reset, oppure volontario.',
    accesso: ACCESSO.sessioneProvvisoria,
  },
  // Dashboard
  {
    path: '/accettazione',
    area: AREE[1],
    descrizione:
      'Coda della giornata per sportello e vista globale: prendi in carico, salta, completa, riattiva, inserimento manuale, riprova sync.',
    accesso: ACCESSO.sessione,
  },
  {
    path: '/accettazione/archivio',
    area: AREE[1],
    descrizione: 'Archivio dei check-in fotografici: ricerca per targa o codice pratica.',
    accesso: ACCESSO.sessione,
  },
  // Tablet
  {
    path: '/check-in',
    area: AREE[2],
    descrizione:
      "Vista tablet a tutto schermo: pratiche in attesa del mio sportello, prese in carico, giro fotografico e conclusione dell'accettazione. Da PC rimanda alla coda.",
    accesso: ACCESSO.sessione,
  },
  {
    path: '/tablet',
    area: AREE[2],
    descrizione:
      'Vecchio indirizzo del tablet: rimanda a /check-in conservando la pratica richiesta.',
    accesso: ACCESSO.sessione,
  },
  // Manager
  {
    path: '/manager',
    area: AREE[3],
    descrizione:
      'Cruscotto del responsabile e del BDC: clienti assenti da ricontattare, chiusura giornata, indicatori e CSV.',
    accesso: ACCESSO.manager,
  },
  // Admin
  {
    path: '/admin',
    area: AREE[4],
    descrizione:
      'Operatori (crea, modifica, disattiva, reset password), assistenza (accettazioni occupate, pratiche ferme) e integrazione Spoki.',
    accesso: ACCESSO.admin,
  },
  {
    path: '/admin/spoki-test',
    area: AREE[4],
    descrizione:
      'Prova controllata dei due promemoria WhatsApp verso un numero digitato a mano; registro dei payload.',
    accesso: ACCESSO.admin,
  },
  // Sistema
  {
    path: '/sistema',
    area: AREE[5],
    descrizione:
      "Stato delle porte esterne (Infinity, Spoki, SMS, CRM); per l'amministratore anche la coda di uscita verso il CRM.",
    accesso: ACCESSO.sessione,
  },
  // Display
  {
    path: '/display/sala-attesa',
    area: AREE[6],
    descrizione:
      "Tabellone della sala d'attesa: codici chiamati con la campata e prossimi turni (`?prossimi=`). Home degli account kiosk.",
    accesso: ACCESSO.monitor,
  },
  {
    path: '/display/:campata',
    area: AREE[6],
    descrizione:
      'Monitor sopra la campata (/display/1 … /display/4 oppure /display/C1): codice e targa della vettura in accettazione.',
    accesso: ACCESSO.monitor,
  },
  // Portale
  {
    path: '/portal',
    area: AREE[7],
    descrizione:
      'Portale cliente mobile dal link WhatsApp o dal QR (`?targa=` e `&t=` token): avanzamento in 4 tappe, posizione in coda, "Sto arrivando in ritardo".',
    accesso: ACCESSO.pubblico,
  },
  {
    path: '/cliente',
    area: AREE[7],
    descrizione: 'Ingresso dal QR code: ricerca per targa.',
    accesso: ACCESSO.pubblico,
  },
  {
    path: '/cliente/stato',
    area: AREE[7],
    descrizione: 'Esito della ricerca per targa: la stessa schermata del portale.',
    accesso: ACCESSO.pubblico,
  },
  {
    path: '/qr',
    area: AREE[7],
    descrizione: 'Alias corto stampato sui cartelli: rimanda a /cliente (con `?src=` corsia).',
    accesso: ACCESSO.pubblico,
  },
  // API auth
  {
    path: '/api/v1/auth/login',
    area: AREE[8],
    descrizione:
      'Verifica credenziali e postazione, imposta il cookie di sessione (limiti di frequenza per IP e utente).',
    accesso: ACCESSO.pubblico,
  },
  {
    path: '/api/v1/auth/logout',
    area: AREE[8],
    descrizione: 'Libera la postazione e cancella il cookie.',
    accesso: ACCESSO.sessioneProvvisoria,
  },
  {
    path: '/api/v1/auth/me',
    area: AREE[8],
    descrizione: 'Sessione corrente (ruolo, postazione, obbligo di cambio password).',
    accesso: ACCESSO.sessioneProvvisoria,
  },
  {
    path: '/api/v1/auth/change-password',
    area: AREE[8],
    descrizione: 'Sostituisce la password (provvisoria o no) e rinnova il cookie.',
    accesso: ACCESSO.sessioneProvvisoria,
  },
  // API coda e pratiche
  {
    path: '/api/v1/queue',
    area: AREE[9],
    descrizione:
      'Coda della giornata (`?date=&deskId=&view=desk oppure global`): righe arricchite, campate, ultima sync, dati di riferimento. Polling della dashboard e del tablet.',
    accesso: ACCESSO.sessione,
  },
  {
    path: '/api/v1/appointments',
    area: AREE[9],
    descrizione:
      'Inserimento manuale di una pratica (cliente senza appuntamento) nella coda di oggi.',
    accesso: ACCESSO.sessione,
  },
  {
    path: '/api/v1/appointments/:id/actions',
    area: AREE[9],
    descrizione:
      'Azioni sulla pratica: take, skip, complete, release, restore, no-show, reactivate, cancel, confirm-auto-close (con `expectedVersion`, 409 sui conflitti).',
    accesso: 'Sessione operatore; `cancel` e `confirm-auto-close` solo Manager e Amministratore',
  },
  {
    path: '/api/v1/appointments/:id/check-in',
    area: AREE[9],
    descrizione:
      "Conclude l'accettazione dal tablet: note dell'ispezione, chiusura pratica, notifica al CRM.",
    accesso: ACCESSO.sessione,
  },
  {
    path: '/api/v1/appointments/:id/media',
    area: AREE[9],
    descrizione:
      "Foto dell'ispezione: elenco (GET) e caricamento multipart dalla fotocamera del tablet (POST).",
    accesso: ACCESSO.sessione,
  },
  {
    path: '/api/v1/media/:key',
    area: AREE[9],
    descrizione: "Rilegge una foto dell'ispezione dallo storage.",
    accesso: ACCESSO.sessione,
  },
  {
    path: '/api/v1/inspections/archive',
    area: AREE[9],
    descrizione:
      'Storico dei check-in fotografici (`?q=` targa o codice; vuoto = ultimi cinquanta).',
    accesso: ACCESSO.sessione,
  },
  {
    path: '/api/v1/events/stream',
    area: AREE[9],
    descrizione:
      "Eventi in tempo reale (SSE) per l'area operatore: segnala cosa è cambiato, i dati si rileggono dagli endpoint.",
    accesso: ACCESSO.sessione,
  },
  {
    path: '/api/v1/sync',
    area: AREE[9],
    descrizione: "Sincronizzazione manuale dell'agenda Infinity di oggi.",
    accesso:
      'Manager e Amministratore; Accettatore solo come «Riprova» dopo una sync fallita o assente',
  },
  // API pubbliche
  {
    path: '/api/v1/health',
    area: AREE[10],
    descrizione:
      'Liveness del processo e stato aggregato delle quattro porte esterne (`?strict=` per il readiness).',
    accesso: ACCESSO.pubblico,
  },
  {
    path: '/api/v1/public/status',
    area: AREE[10],
    descrizione:
      'Stato della pratica per il portale (`?targa=` o `?t=` token): tappa, posizione in coda, orario, accettatore, sede.',
    accesso: ACCESSO.pubblico,
  },
  {
    path: '/api/v1/public/late-notice',
    area: AREE[10],
    descrizione:
      '"Sto arrivando in ritardo (+10 min)" dal portale: sposta l\'arrivo atteso e avvisa la dashboard.',
    accesso: ACCESSO.pubblico,
  },
  {
    path: '/api/v1/public/board',
    area: AREE[10],
    descrizione: "Dati del tabellone della sala d'attesa (`?prossimi=`).",
    accesso: ACCESSO.pubblico,
  },
  {
    path: '/api/v1/public/display',
    area: AREE[10],
    descrizione:
      'Stato del monitor di una campata (`?campata=1`, `?bay=`, `?bayCode=`): solo codice e targa.',
    accesso: ACCESSO.monitor,
  },
  {
    path: '/api/v1/public/events/stream',
    area: AREE[10],
    descrizione:
      'Eventi in tempo reale (SSE) per monitor e tabellone: solo il tipo di evento, senza identificativi.',
    accesso: ACCESSO.pubblico,
  },
  // API manager
  {
    path: '/api/v1/reports/daily',
    area: AREE[11],
    descrizione: 'Indicatori della giornata (`?giornata=`).',
    accesso: ACCESSO.manager,
  },
  {
    path: '/api/v1/reports/daily/csv',
    area: AREE[11],
    descrizione: 'Riepilogo dettagliato della giornata in CSV (con BOM per Excel).',
    accesso: ACCESSO.manager,
  },
  {
    path: '/api/v1/crm/leads',
    area: AREE[11],
    descrizione:
      'Clienti da ricontattare per il BDC (`?giornata=&gestiti=1`): nomi e telefoni degli assenti.',
    accesso: ACCESSO.manager,
  },
  {
    path: '/api/v1/crm/leads/:id/contacted',
    area: AREE[11],
    descrizione: 'Il BDC dichiara di aver ricontattato il cliente (chi, esito).',
    accesso: ACCESSO.manager,
  },
  {
    path: '/api/v1/system/close-day',
    area: AREE[11],
    descrizione:
      "Chiusura della giornata: chi è in coda diventa assente (lead BDC), chi è in carico viene chiuso d'ufficio.",
    accesso: ACCESSO.manager,
  },
  // API admin
  {
    path: '/api/v1/admin/operators',
    area: AREE[12],
    descrizione:
      'Elenco (GET) e creazione (POST) degli operatori, con sportelli e postazioni per i menu.',
    accesso: ACCESSO.admin,
  },
  {
    path: '/api/v1/admin/operators/:id',
    area: AREE[12],
    descrizione:
      'Modifica di un operatore: nome, ruolo, sportelli, postazione predefinita, attivazione.',
    accesso: ACCESSO.admin,
  },
  {
    path: '/api/v1/admin/operators/:id/reset-password',
    area: AREE[12],
    descrizione: 'Nuova password provvisoria, restituita una sola volta.',
    accesso: ACCESSO.admin,
  },
  {
    path: '/api/v1/admin/assistance',
    area: AREE[12],
    descrizione: 'Accettazioni occupate e pratiche in carico da troppo tempo.',
    accesso: ACCESSO.admin,
  },
  {
    path: '/api/v1/admin/spoki',
    area: AREE[12],
    descrizione:
      "Stato dell'integrazione WhatsApp (provider, modalità, safety lock, override consenso, template) e registro dei payload.",
    accesso: ACCESSO.admin,
  },
  {
    path: '/api/v1/admin/spoki/test',
    area: AREE[12],
    descrizione:
      'Invio di prova di un promemoria a un numero digitato a mano (in simulazione finisce nel registro).',
    accesso: ACCESSO.admin,
  },
  {
    path: '/api/v1/crm/outbox',
    area: AREE[12],
    descrizione: 'Coda di uscita verso il CRM, vista tecnica (`?stato=&limite=`).',
    accesso: ACCESSO.admin,
  },
  {
    path: '/api/v1/crm/outbox/:id/retry',
    area: AREE[12],
    descrizione: '"Forza riprova" di un evento verso il CRM.',
    accesso: ACCESSO.admin,
  },
  // API sistema e cron
  {
    path: '/api/v1/system/cron/reminders',
    area: AREE[13],
    descrizione:
      'Promemoria ai clienti (`?kind=previous-day oppure same-day`) per un cron esterno; stesso servizio dello scheduler interno.',
    accesso: ACCESSO.cron,
  },
  {
    path: '/api/v1/system/cron/crm-retry',
    area: AREE[13],
    descrizione: 'Svuotamento della coda di uscita verso il CRM (rinvii) per un cron esterno.',
    accesso: ACCESSO.cron,
  },
  {
    path: '/api/v1/system/cron/media-retention',
    area: AREE[13],
    descrizione: 'Eliminazione dei file delle foto oltre la retention per un cron esterno.',
    accesso: ACCESSO.cron,
  },
];

/** Da una cartella di `src/app` all'indirizzo: via i gruppi `(x)`, `[param]` → `:param`. */
function toUrl(relDir) {
  const segmenti = relDir
    .split(sep)
    .filter((s) => s !== '' && !/^\(.*\)$/.test(s))
    .map((s) => s.replace(/^\[\.\.\.(.*)\]$/, ':$1*').replace(/^\[(.*)\]$/, ':$1'));
  return `/${segmenti.join('/')}`;
}

/** Legge ricorsivamente `src/app` e restituisce pagine e Route Handler con i metodi HTTP esportati. */
export function scanRoutes(appDir) {
  const trovate = [];
  const visita = (dir) => {
    for (const nome of readdirSync(dir)) {
      const pieno = join(dir, nome);
      if (statSync(pieno).isDirectory()) {
        visita(pieno);
      } else if (nome === 'page.tsx' || nome === 'route.ts') {
        const sorgente = readFileSync(pieno, 'utf8');
        const metodi = METODI.filter((m) =>
          new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b`).test(sorgente),
        );
        trovate.push({
          path: toUrl(relative(appDir, dir)),
          kind: nome === 'page.tsx' ? 'page' : 'api',
          methods: nome === 'page.tsx' ? ['GET'] : metodi,
          file: relative(appDir, pieno).split(sep).join('/'),
        });
      }
    }
  };
  visita(appDir);
  return trovate.sort((a, b) => a.path.localeCompare(b.path));
}

/** Incrocia le rotte trovate con l'elenco curato. */
export function mappa(appDir) {
  const trovate = scanRoutes(appDir);
  const descritte = new Map(ROTTE.map((r) => [r.path, r]));
  const senzaDescrizione = trovate.filter((t) => !descritte.has(t.path)).map((t) => t.path);
  const stantie = ROTTE.filter((r) => !trovate.some((t) => t.path === r.path)).map((r) => r.path);
  const righe = trovate
    .filter((t) => descritte.has(t.path))
    .map((t) => ({ ...descritte.get(t.path), kind: t.kind, methods: t.methods, file: t.file }));
  return { righe, senzaDescrizione, stantie };
}

function perArea(righe) {
  return AREE.map((area) => ({
    area,
    righe: righe
      .filter((r) => r.area === area)
      .sort(
        (a, b) =>
          ROTTE.findIndex((r) => r.path === a.path) - ROTTE.findIndex((r) => r.path === b.path),
      ),
  })).filter((g) => g.righe.length > 0);
}

function metodo(r) {
  return r.kind === 'page' ? 'pagina' : r.methods.join(', ');
}

/** Tabella Markdown allineata (come la formatta Prettier). */
function tabella(intestazioni, righe) {
  const larghezze = intestazioni.map((h, i) =>
    Math.max(h.length, ...righe.map((r) => r[i].length)),
  );
  const riga = (celle) => `| ${celle.map((c, i) => c.padEnd(larghezze[i])).join(' | ')} |`;
  return [
    riga(intestazioni),
    `| ${larghezze.map((w) => '-'.repeat(w)).join(' | ')} |`,
    ...righe.map(riga),
  ].join('\n');
}

export function renderMarkdown(m) {
  const blocchi = perArea(m.righe).map(
    (g) =>
      `### ${g.area}\n\n${tabella(
        ['Rotta', 'Metodo', 'Descrizione', 'Accesso'],
        g.righe.map((r) => [`\`${r.path}\``, metodo(r), r.descrizione, r.accesso]),
      )}`,
  );
  return `${blocchi.join('\n\n')}\n`;
}

export function renderConsole(m) {
  const righe = [];
  for (const g of perArea(m.righe)) {
    righe.push('', `== ${g.area}`);
    const larghezza = Math.max(...g.righe.map((r) => r.path.length));
    for (const r of g.righe) {
      righe.push(`  ${r.path.padEnd(larghezza)}  [${metodo(r)}]  ${r.descrizione}`);
      righe.push(`  ${' '.repeat(larghezza)}  accesso: ${r.accesso}`);
    }
  }
  righe.push('', `${m.righe.length} rotte descritte.`);
  return righe.join('\n');
}

export const README_INIZIO = '<!-- mappa-rotte:inizio -->';
export const README_FINE = '<!-- mappa-rotte:fine -->';

/** Sostituisce la sezione fra i marcatori del README con la mappa generata. */
export function aggiornaReadme(readmePath, markdown) {
  const src = readFileSync(readmePath, 'utf8');
  const inizio = src.indexOf(README_INIZIO);
  const fine = src.indexOf(README_FINE);
  if (inizio === -1 || fine === -1 || fine < inizio) {
    throw new Error(`README senza i marcatori ${README_INIZIO} … ${README_FINE}`);
  }
  const nuovo = `${src.slice(0, inizio + README_INIZIO.length)}\n\n${markdown}\n${src.slice(fine)}`;
  writeFileSync(readmePath, nuovo, 'utf8');
}

function main() {
  const radice = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const m = mappa(join(radice, 'src', 'app'));
  const argomenti = process.argv.slice(2);
  if (argomenti.includes('--readme')) {
    aggiornaReadme(join(radice, 'README.md'), renderMarkdown(m));
    console.log(`README aggiornato: ${m.righe.length} rotte.`);
  } else if (argomenti.includes('--markdown')) {
    console.log(renderMarkdown(m));
  } else {
    console.log(renderConsole(m));
  }
  if (m.senzaDescrizione.length > 0 || m.stantie.length > 0) {
    console.error(
      `\nATTENZIONE: rotte senza descrizione: ${m.senzaDescrizione.join(', ') || 'nessuna'}; ` +
        `descrizioni di rotte inesistenti: ${m.stantie.join(', ') || 'nessuna'}.`,
    );
    process.exitCode = 1;
  }
}

const eseguitoDirettamente =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (eseguitoDirettamente) {
  main();
}
