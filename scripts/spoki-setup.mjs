#!/usr/bin/env node
// Configura l'account Spoki per l'officina, via API REST, con la stessa chiave dell'app
// (SPOKI_API_KEY in .env.local). Cosa deve esistere sta in scripts/spoki-spec.mjs; perché, in
// docs/SPOKI.md.
//
//   npm run spoki:setup                         controllo: cosa c'è e cosa manca (sola lettura)
//   npm run spoki:setup -- --apply              crea campi, template (in bozza) e automazioni
//                                               (disattivate) che mancano
//   npm run spoki:setup -- --apply --submit     in più chiede a Meta l'approvazione dei template
//   … --app-url=https://officina.example        indirizzo pubblico dell'app (predefinito
//                                               PUBLIC_BASE_URL); serve ad automazioni e webhook
//   … --webhooks                                crea anche i due webhook V2 (inbound, outbound)
//   … --write-env                               scrive in .env.local gli id dei template e i
//                                               segreti dei webhook creati (mai a schermo)
//   … --safety-net-time=08:30                   ora della rete di sicurezza (predefinito
//                                               SPOKI_SAFETY_NET_TIME, altrimenti 08:30)
//
// Non stampa mai chiave API né segreti. REGOLA DEL COMMITTENTE (2026-09-25): ciò che esiste già
// nell'account NON si modifica, mai. Lo script legge, crea solo ciò che manca e chiede l'approvazione
// a Meta solo per i template che ha appena creato lui; ogni altra chiamata (PATCH, PUT, DELETE, o un
// POST diverso da una creazione) la ferma `chiamataAmmessa` prima che parta.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUTOMAZIONI,
  CAMPI,
  EVENTI_WEBHOOK,
  PULSANTI,
  TEMPLATE,
  corpoAutomazioneRete,
  corpoAutomazioneRisposta,
  corpoTemplate,
  urlWebhook,
} from './spoki-spec.mjs';

// --- .env.local -----------------------------------------------------------------------------------

/** Legge un file .env: KEY=valore, commenti e righe vuote ignorati, virgolette tolte. */
export function parseEnvText(testo) {
  const out = {};
  for (const riga of testo.split(/\r?\n/)) {
    const m = riga.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m === null) {
      continue;
    }
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

/**
 * Aggiorna (o aggiunge in fondo) le variabili indicate lasciando intatto il resto del file:
 * commenti, ordine e valori degli altri.
 */
export function aggiornaEnvText(testo, valori) {
  const righe = testo.split(/\r?\n/);
  const fatti = new Set();
  const nuove = righe.map((riga) => {
    const m = riga.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (m !== null && m[1] in valori && !fatti.has(m[1])) {
      fatti.add(m[1]);
      return `${m[1]}=${valori[m[1]]}`;
    }
    return riga;
  });
  const mancanti = Object.keys(valori).filter((k) => !fatti.has(k));
  if (mancanti.length > 0) {
    if (nuove.length > 0 && nuove[nuove.length - 1] === '') {
      nuove.pop();
    }
    nuove.push('# Scritto da npm run spoki:setup', ...mancanti.map((k) => `${k}=${valori[k]}`), '');
  }
  return nuove.join('\n');
}

// --- Regola: niente modifiche a ciò che esiste ----------------------------------------------------

/** Le sole creazioni ammesse: campi, template, automazioni, webhook V2. */
const CREAZIONI = [
  '/api/1/custom-fields/',
  '/api/1/templates/',
  '/api/1/automations/',
  '/api/1/external-webhooks/',
];

/**
 * True se la chiamata può partire: letture, creazioni, e la richiesta di approvazione di un template
 * creato in questo giro (`creatiOra`: id dei template appena creati). Tutto il resto — aggiornare,
 * cancellare, inviare a Meta un template che c'era già — no.
 */
export function chiamataAmmessa(metodo, percorso, creatiOra = new Set()) {
  const p = new URL(percorso, 'https://api.spoki.invalid').pathname;
  if (metodo === 'GET') {
    return true;
  }
  if (metodo !== 'POST') {
    return false;
  }
  if (CREAZIONI.includes(p)) {
    return true;
  }
  const invio = p.match(/^\/api\/1\/templates\/([^/]+)\/submit\/$/);
  return invio !== null && creatiOra.has(String(invio[1]));
}

// --- Stato dell'account e piano -------------------------------------------------------------------

function elenco(risposta) {
  if (Array.isArray(risposta)) {
    return risposta;
  }
  if (risposta !== null && typeof risposta === 'object' && Array.isArray(risposta.results)) {
    return risposta.results;
  }
  return [];
}

/** Stato di un template Spoki: quello della localizzazione italiana, o il primo. */
export function statoTemplate(t) {
  const loc = elenco(t.templatelocalization_set);
  const it = loc.find((l) => String(l.language).toLowerCase() === 'it') ?? loc[0];
  if (t.is_approved === true) {
    return 'APPROVED';
  }
  return typeof it?.status === 'string' ? it.status.toUpperCase() : 'SCONOSCIUTO';
}

/**
 * Confronta la specifica con quello che l'account ha già. `stato` ha gli elenchi grezzi dell'API
 * (`campi`, `template`, `automazioni`, `webhook`); il piano dice, voce per voce, cosa esiste (con
 * l'id) e cosa manca.
 */
export function pianifica(stato, { appUrl = null } = {}) {
  const campi = CAMPI.map((c) => {
    const trovato = stato.campi.find((x) => String(x.code ?? '').toUpperCase() === c.code);
    return {
      code: c.code,
      id: trovato?.id ?? null,
      tipoGiusto:
        trovato === undefined ||
        trovato.field_type === undefined ||
        Number(trovato.field_type) === c.tipo,
    };
  });
  const template = TEMPLATE.map((t) => {
    const trovato = stato.template.find((x) => x.name === t.name);
    return {
      name: t.name,
      env: t.env,
      id: trovato?.id ?? null,
      stato: trovato === undefined ? null : statoTemplate(trovato),
    };
  });
  const automazioni = Object.entries(AUTOMAZIONI).map(([chiave, nome]) => {
    const trovata = stato.automazioni.find((x) => x.name === nome);
    return { chiave, nome, id: trovata?.id ?? null, attiva: trovata?.is_active === true };
  });
  const webhook =
    appUrl === null
      ? []
      : EVENTI_WEBHOOK.map((evento) => {
          const trovato = stato.webhook.find(
            (x) => x.event === evento && String(x.url ?? '') === urlWebhook(appUrl),
          );
          return { evento, id: trovato?.id ?? null, attivo: trovato?.is_active === true };
        });
  return { campi, template, automazioni, webhook };
}

// --- Client API ----------------------------------------------------------------------------------

/** Pause minime fra due chiamate, dai limiti documentati da Spoki (al minuto). */
const PAUSA_MS = { 'custom-fields': 12_500, 'external-webhooks': 2_100, altro: 1_100 };

function creaClient({ base, chiave, segreti, creatiOra }) {
  const ultima = new Map();
  const oscura = (testo) =>
    [chiave, ...segreti]
      .filter((s) => typeof s === 'string' && s.length >= 6)
      .reduce((t, s) => t.split(s).join('••••'), testo);

  async function chiama(metodo, percorso, corpo) {
    if (!chiamataAmmessa(metodo, percorso, creatiOra)) {
      throw new Error(
        `${metodo} ${percorso} fermata: lo script non modifica niente di ciò che esiste nell'account.`,
      );
    }
    const url = percorso.startsWith('http') ? percorso : `${base.replace(/\/+$/, '')}${percorso}`;
    const risorsa = Object.keys(PAUSA_MS).find((k) => url.includes(`/api/1/${k}/`)) ?? 'altro';
    const attesa = (ultima.get(risorsa) ?? 0) + PAUSA_MS[risorsa] - Date.now();
    if (attesa > 0) {
      await new Promise((r) => setTimeout(r, attesa));
    }
    ultima.set(risorsa, Date.now());
    const risposta = await fetch(url, {
      method: metodo,
      headers: {
        'X-Spoki-Api-Key': chiave,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const testo = await risposta.text();
    if (!risposta.ok) {
      throw new Error(`${metodo} ${percorso} → ${risposta.status}: ${oscura(testo).slice(0, 400)}`);
    }
    return testo === '' ? null : JSON.parse(testo);
  }

  async function tutti(percorso) {
    const out = [];
    let prossimo = percorso;
    for (let pagine = 0; prossimo && pagine < 50; pagine += 1) {
      const r = await chiama('GET', prossimo);
      out.push(...elenco(r));
      prossimo = r !== null && typeof r === 'object' && typeof r.next === 'string' ? r.next : null;
    }
    return out;
  }

  return { chiama, tutti };
}

// --- Esecuzione ----------------------------------------------------------------------------------

function opzioni(argv) {
  const valore = (nome) =>
    argv.find((a) => a.startsWith(`--${nome}=`))?.slice(nome.length + 3) ?? null;
  return {
    apply: argv.includes('--apply'),
    submit: argv.includes('--submit'),
    webhooks: argv.includes('--webhooks'),
    writeEnv: argv.includes('--write-env'),
    appUrl: valore('app-url'),
    ora: valore('safety-net-time'),
  };
}

function riga(stato, testo) {
  console.log(`  ${stato.padEnd(12)} ${testo}`);
}

async function main() {
  const radice = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const fileEnv = resolve(radice, '.env.local');
  const env = {
    ...(existsSync(resolve(radice, '.env'))
      ? parseEnvText(readFileSync(resolve(radice, '.env'), 'utf8'))
      : {}),
    ...(existsSync(fileEnv) ? parseEnvText(readFileSync(fileEnv, 'utf8')) : {}),
    ...process.env,
  };
  const o = opzioni(process.argv.slice(2));
  const chiave = (env.SPOKI_API_KEY ?? '').trim();
  if (chiave.length < 20) {
    console.error(
      'SPOKI_API_KEY mancante o di prova in .env.local: inseriscila (Spoki → Integrazioni → API) e rilancia.',
    );
    process.exit(2);
  }
  const base = (env.SPOKI_API_BASE_URL ?? '').trim() || 'https://api.spoki.com';
  const inboundSecret = (env.SPOKI_INBOUND_SECRET ?? '').trim();
  const appUrl = (o.appUrl ?? env.PUBLIC_BASE_URL ?? '').trim() || null;
  const appPubblica = appUrl !== null && appUrl.startsWith('https://');
  const ora = o.ora ?? ((env.SPOKI_SAFETY_NET_TIME ?? '').trim() || '08:30');
  // Id dei template creati in questo giro: gli unici per cui si può chiedere l'approvazione.
  const creatiOra = new Set();
  const api = creaClient({ base, chiave, segreti: [inboundSecret], creatiOra });

  console.log(`Spoki: ${base} · app: ${appUrl ?? '(indirizzo pubblico non impostato)'}`);
  console.log(
    o.apply
      ? 'Modalità: CREAZIONE di ciò che manca'
      : 'Modalità: solo controllo (nessuna modifica)',
  );

  const stato = {
    campi: await api.tutti('/api/1/custom-fields/'),
    template: await api.tutti('/api/1/templates/'),
    automazioni: await api.tutti('/api/1/automations/'),
    webhook: o.webhooks ? await api.tutti('/api/1/external-webhooks/') : [],
  };
  const piano = pianifica(stato, { appUrl: o.webhooks && appPubblica ? appUrl : null });
  const envDaScrivere = {};
  const segretiNuovi = [];

  console.log('\nCampi del contatto');
  for (const c of piano.campi) {
    if (c.id === null && o.apply) {
      const spec = CAMPI.find((x) => x.code === c.code);
      const creato = await api.chiama('POST', '/api/1/custom-fields/', {
        label: c.code,
        code: c.code,
        field_type: spec.tipo,
        example: spec.esempio,
      });
      c.id = creato?.id ?? null;
      riga('CREATO', `${c.code} (id ${c.id})`);
    } else {
      riga(
        c.id === null ? 'MANCA' : c.tipoGiusto ? 'ok' : 'TIPO DIVERSO',
        `${c.code}${c.id === null ? '' : ` (id ${c.id})`}`,
      );
    }
  }

  console.log('\nTemplate (da far approvare a Meta)');
  for (const t of piano.template) {
    const spec = TEMPLATE.find((x) => x.name === t.name);
    if (t.id === null && o.apply) {
      const creato = await api.chiama('POST', '/api/1/templates/', corpoTemplate(spec));
      t.id = creato?.id ?? null;
      t.stato = creato === null ? 'DRAFT' : statoTemplate(creato);
      if (t.id !== null) {
        creatiOra.add(String(t.id));
      }
      riga('CREATO', `${t.name} (id ${t.id}, ${t.stato})`);
    } else {
      riga(
        t.id === null ? 'MANCA' : (t.stato ?? '?'),
        `${t.name}${t.id === null ? '' : ` (id ${t.id})`}`,
      );
    }
    // Solo i template appena creati: uno che c'era già (anche in bozza) non si tocca.
    if (t.id !== null && o.submit && creatiOra.has(String(t.id))) {
      await api.chiama('POST', `/api/1/templates/${t.id}/submit/`);
      t.stato = 'INVIATO A META';
      riga('RICHIESTO', `${t.name}: approvazione chiesta a Meta`);
    } else if (t.id !== null && o.submit) {
      riga('non toccato', `${t.name}: esisteva già, l'approvazione si chiede da Spoki`);
    }
    if (t.id !== null) {
      envDaScrivere[t.env] = String(t.id);
    }
  }

  console.log('\nAutomazioni');
  const campiId = Object.fromEntries(piano.campi.map((c) => [c.code, c.id]));
  const templateId = Object.fromEntries(piano.template.map((t) => [t.name, t.id]));
  const ids = { campi: campiId, template: templateId };
  const campiCompleti = piano.campi.every((c) => c.id !== null);
  for (const a of piano.automazioni) {
    if (a.id !== null) {
      riga(a.attiva ? 'ATTIVA' : 'disattivata', `${a.nome} (id ${a.id})`);
      continue;
    }
    if (!o.apply) {
      riga('MANCA', a.nome);
      continue;
    }
    if (!campiCompleti) {
      riga('RIMANDATA', `${a.nome}: mancano campi del contatto`);
      continue;
    }
    let corpo;
    if (a.chiave === 'rete') {
      if (
        templateId.acc_promemoria_giorno === null ||
        templateId.acc_promemoria_giorno === undefined
      ) {
        riga('RIMANDATA', `${a.nome}: manca il template acc_promemoria_giorno`);
        continue;
      }
      corpo = corpoAutomazioneRete({ ids, ora });
    } else {
      if (!appPubblica || inboundSecret.length < 16) {
        riga(
          'RIMANDATA',
          `${a.nome}: serve l'indirizzo pubblico https dell'app (--app-url) e SPOKI_INBOUND_SECRET`,
        );
        continue;
      }
      const pulsante = PULSANTI.find((p) => p.chiave === a.chiave);
      corpo = corpoAutomazioneRisposta(pulsante, { ids, appUrl, inboundSecret });
    }
    const creata = await api.chiama('POST', '/api/1/automations/', corpo);
    a.id = creata?.id ?? null;
    riga('CREATA', `${a.nome} (id ${a.id}, disattivata)`);
  }

  if (o.webhooks) {
    console.log("\nWebhook V2 dell'account");
    if (!appPubblica) {
      riga('RIMANDATI', "serve l'indirizzo pubblico https dell'app (--app-url)");
    }
    for (const w of piano.webhook) {
      if (w.id !== null) {
        riga(w.attivo ? 'ATTIVO' : 'disattivato', `${w.evento} (id ${w.id})`);
      } else if (o.apply) {
        const creato = await api.chiama('POST', '/api/1/external-webhooks/', {
          version: 2,
          url: urlWebhook(appUrl),
          event: w.evento,
          is_active: true,
        });
        if (typeof creato?.secret === 'string') {
          segretiNuovi.push(creato.secret);
        }
        riga('CREATO', `${w.evento} (id ${creato?.id ?? '?'}) · segreto ricevuto, non mostrato`);
      } else {
        riga('MANCA', w.evento);
      }
    }
  }

  if (o.writeEnv && existsSync(fileEnv)) {
    if (segretiNuovi.length > 0) {
      const esistenti = (env.SPOKI_WEBHOOK_SECRET ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      envDaScrivere.SPOKI_WEBHOOK_SECRET = [...new Set([...esistenti, ...segretiNuovi])].join(',');
    }
    if (Object.keys(envDaScrivere).length > 0) {
      writeFileSync(fileEnv, aggiornaEnvText(readFileSync(fileEnv, 'utf8'), envDaScrivere));
      console.log(
        `\n.env.local aggiornato: ${Object.keys(envDaScrivere).join(', ')} (riavvia l'app).`,
      );
    }
  } else if (segretiNuovi.length > 0) {
    console.log(
      '\nATTENZIONE: i segreti dei webhook appena creati non sono stati salvati. Rilancia con --write-env oppure ruotali in Spoki e copiali in SPOKI_WEBHOOK_SECRET.',
    );
  }

  console.log("\nPassi a mano (l'API non li espone), dettagli in docs/SPOKI.md:");
  console.log('  1. approvazione dei template da parte di Meta (si segue in Spoki → Template);');
  console.log(
    "  2. nell'editor delle tre automazioni «ACC · Risposta …»: trigger «Messaggio del cliente → clic su un pulsante di un template» sul pulsante giusto di acc_promemoria_giorno, poi Attiva;",
  );
  console.log(
    `  3. dopo la prova interna: attiva «${AUTOMAZIONI.rete}», SPOKI_SAFETY_NET_TIME=${ora} e SPOKI_REPLIES_BY_AUTOMATION=true in .env.local.`,
  );
}

// Eseguito come script (non importato dal test).
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((errore) => {
    console.error(`\nInterrotto: ${errore instanceof Error ? errore.message : String(errore)}`);
    process.exit(1);
  });
}
