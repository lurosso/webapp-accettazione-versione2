// Dati di riferimento (marchi, sportelli, postazioni, campate, operatori), in due profili:
// - demo (predefinito): officina di prova con 7 marchi, password "plain:demo" e token display
//   prevedibili. SOLO sviluppo: il container li rifiuta appena un provider è reale o
//   NODE_ENV=production.
// - real (SEED_PROFILE=real): l'officina Autoclub di Bari come emerge dal planning di Infinity
//   (prenotazioni maggio-settembre 2026): i marchi veri più «Altri marchi» per quelli sporadici
//   (Hyundai, Foton…), un solo account amministratore con hash scrypt da SEED_ADMIN_PASSWORD_HASH e
//   password da cambiare al primo accesso; gli accettatori li crea l'amministratore da /admin. I
//   token dei display derivano da SEED_DISPLAY_TOKEN_SECRET (HMAC), così non stanno nel repository.
//   I tre valori si generano con `npm run seed:credenziali`.
//
// La geometria dell'accettazione è la stessa nei due profili e la vede anche il cliente:
// QUATTRO SPORTELLI FISICI, A, B, C e D, che lavorano a coppie. A e B servono i marchi FCA (Fiat,
// Lancia, Alfa Romeo, Jeep…), C e D i marchi PSA (Peugeot, Citroën, DS, Opel…). Nel dominio ogni
// sportello fisico è una postazione (Workstation) con la propria campata e il proprio monitor (Bay),
// e appartiene a uno dei due sportelli logici per marchio (Desk FCA / PSA). Tabellone, monitor e
// portale dicono al cliente la LETTERA: "Sportello B", non un numero interno.

import { createHmac } from 'node:crypto';
import type { Bay } from '@/domain/entities/bay';
import { FALLBACK_BRAND_CODE, type Brand } from '@/domain/entities/brand';
import type { Desk } from '@/domain/entities/desk';
import type { Operator } from '@/domain/entities/operator';
import type { Workstation } from '@/domain/entities/workstation';
import { ConfigurationError } from '@/domain/errors';
import { asBayId, asBrandId, asDeskId, asOperatorId, asWorkstationId } from '@/domain/ids';
import type { SeedProfile } from './env';

/** Insieme dei dati di riferimento caricati nello store alla prima creazione del container. */
export interface SeedData {
  readonly brands: readonly Brand[];
  readonly desks: readonly Desk[];
  readonly workstations: readonly Workstation[];
  readonly bays: readonly Bay[];
  readonly operators: readonly Operator[];
}

/** Parametri del seed letti dall'ambiente (sottoinsieme di AppEnv). */
export interface SeedOptions {
  readonly seedProfile: SeedProfile;
  /** Hash scrypt della password iniziale di "admin", anche nella forma `base64:<hash>` (profilo real). */
  readonly seedAdminPasswordHash: string | null;
  /** Segreto da cui derivano i token dei display (profilo real). */
  readonly seedDisplayTokenSecret: string | null;
}

/** Profilo demo: è il default di `buildSeedData()`, usato da test e sviluppo. */
export const DEMO_SEED_OPTIONS: SeedOptions = {
  seedProfile: 'demo',
  seedAdminPasswordHash: null,
  seedDisplayTokenSecret: null,
};

/** Prefisso che marca una password demo in chiaro (SOLO sviluppo; il container la rifiuta con provider reali). */
export const DEMO_PASSWORD_PREFIX = 'plain:';

/** Password demo in chiaro, riconoscibile dal prefisso "plain:" (SOLO sviluppo). */
export const DEMO_PASSWORD_HASH = `${DEMO_PASSWORD_PREFIX}demo`;

/** Prefisso dei token display demo (SOLO sviluppo; nel profilo real i token derivano da un segreto). */
export const DEMO_DISPLAY_TOKEN_PREFIX = 'display-demo-';

/** Lunghezza minima del segreto dei token display nel profilo real. */
export const SEED_DISPLAY_TOKEN_SECRET_MIN_LENGTH = 16;

/**
 * Le lettere dei quattro sportelli fisici, nell'ordine in cui stanno in sala. Sono ciò che il
 * cliente legge sul tabellone ("F012 → Sportello B") e sopra ogni postazione.
 */
export const DESK_LETTERS = ['A', 'B', 'C', 'D'] as const;
export type DeskLetter = (typeof DESK_LETTERS)[number];

/** Id interni delle due aree per marchio (stabili: li usano fixture, test e sessioni). */
export const FCA_DESK_ID = asDeskId('desk-s1');
export const PSA_DESK_ID = asDeskId('desk-s2');

/** Indica se il seed contiene ancora credenziali o token demo prevedibili. */
export function hasDemoCredentials(seed: SeedData): boolean {
  return (
    seed.operators.some((o) => o.passwordHash.startsWith(DEMO_PASSWORD_PREFIX)) ||
    seed.bays.some((b) => b.displayToken.startsWith(DEMO_DISPLAY_TOKEN_PREFIX))
  );
}

/** Dati di riferimento del profilo richiesto (demo se non indicato). */
export function buildSeedData(options: SeedOptions = DEMO_SEED_OPTIONS): SeedData {
  return options.seedProfile === 'real' ? buildRealSeedData(options) : buildDemoSeedData();
}

function brand(code: string, name: string, codePrefix: string): Brand {
  return {
    id: asBrandId(`brand-${code.toLowerCase()}`),
    code,
    name,
    codePrefix,
    colorToken: `brand-${code.toLowerCase().replace(/_/g, '-')}`,
    isActive: true,
  };
}

const brandId = (code: string): Brand['id'] => asBrandId(`brand-${code.toLowerCase()}`);

/** Sportello logico per marchio: A e B → FCA, C e D → PSA. */
function desksFor(fcaBrands: readonly string[], psaBrands: readonly string[]): Desk[] {
  return [
    {
      id: FCA_DESK_ID,
      code: 'FCA',
      name: 'Sportelli A e B',
      brandIds: fcaBrands.map(brandId),
      isActive: true,
    },
    {
      id: PSA_DESK_ID,
      code: 'PSA',
      name: 'Sportelli C e D',
      brandIds: psaBrands.map(brandId),
      isActive: true,
    },
  ];
}

/**
 * Le quattro campate con il monitor, una per sportello fisico. Gli id restano `bay-c1`…`bay-c4`
 * (li conoscono fixture e sessioni); codice e nome portano la lettera che legge il cliente.
 */
function baysFor(tokenFor: (letter: DeskLetter, n: 1 | 2 | 3 | 4) => string): Bay[] {
  return DESK_LETTERS.map((letter, i) => {
    const n = (i + 1) as 1 | 2 | 3 | 4;
    return {
      id: asBayId(`bay-c${n}`),
      code: letter,
      number: n,
      name: `Sportello ${letter}`,
      displayToken: tokenFor(letter, n),
      isActive: true,
    };
  });
}

/** Le quattro postazioni: A e B sull'area FCA, C e D sull'area PSA, ognuna con la propria campata. */
function workstationsAD(): Workstation[] {
  return DESK_LETTERS.map((letter, i) => {
    const n = i + 1;
    return {
      id: asWorkstationId(`ws-p${n}`),
      code: letter,
      name: `Sportello ${letter}`,
      deskId: n <= 2 ? FCA_DESK_ID : PSA_DESK_ID,
      defaultBayId: asBayId(`bay-c${n}`),
    };
  });
}

/** Costruisce i dati demo (7 marchi, 2 aree FCA/PSA, 4 sportelli A–D, 5 operatori). */
function buildDemoSeedData(): SeedData {
  const brands: Brand[] = [
    brand('FIAT', 'Fiat', 'F'),
    brand('JEEP', 'Jeep', 'J'),
    brand('ALFA_ROMEO', 'Alfa Romeo', 'A'),
    brand('LANCIA', 'Lancia', 'L'),
    brand('PEUGEOT', 'Peugeot', 'P'),
    brand('CITROEN', 'Citroën', 'C'),
    brand('OPEL', 'Opel', 'O'),
  ];
  const desks = desksFor(['FIAT', 'LANCIA', 'JEEP', 'ALFA_ROMEO'], ['PEUGEOT', 'CITROEN', 'OPEL']);
  // Token demo prevedibile: nel profilo real deriva da SEED_DISPLAY_TOKEN_SECRET.
  const bays = baysFor((letter) => `${DEMO_DISPLAY_TOKEN_PREFIX}token-${letter.toLowerCase()}`);
  const workstations = workstationsAD();

  const operators: Operator[] = [
    {
      id: asOperatorId('op-admin'),
      username: 'admin',
      // Nome proprio anche per l'amministratore: nell'intestazione si legge chi è collegato,
      // il ruolo è un'informazione a parte.
      displayName: 'Luca Moretti',
      role: 'ADMIN',
      deskIds: desks.map((d) => d.id),
      defaultWorkstationId: null,
      passwordHash: DEMO_PASSWORD_HASH,
      isActive: true,
      mustChangePassword: false,
    },
    {
      id: asOperatorId('op-supervisor'),
      username: 'responsabile',
      displayName: 'Giulia Ferrari',
      role: 'SUPERVISOR',
      deskIds: desks.map((d) => d.id),
      defaultWorkstationId: asWorkstationId('ws-p1'),
      passwordHash: DEMO_PASSWORD_HASH,
      isActive: true,
      mustChangePassword: false,
    },
    {
      id: asOperatorId('op-advisor-1'),
      username: 'mario.rossi',
      displayName: 'Mario Rossi',
      role: 'ADVISOR',
      deskIds: [FCA_DESK_ID],
      defaultWorkstationId: asWorkstationId('ws-p2'),
      passwordHash: DEMO_PASSWORD_HASH,
      isActive: true,
      mustChangePassword: false,
    },
    {
      id: asOperatorId('op-advisor-2'),
      username: 'laura.bianchi',
      displayName: 'Laura Bianchi',
      role: 'ADVISOR',
      deskIds: [PSA_DESK_ID],
      defaultWorkstationId: asWorkstationId('ws-p3'),
      passwordHash: DEMO_PASSWORD_HASH,
      isActive: true,
      mustChangePassword: false,
    },
    {
      id: asOperatorId('op-advisor-3'),
      username: 'andrea.conti',
      displayName: 'Andrea Conti',
      role: 'ADVISOR',
      deskIds: [PSA_DESK_ID],
      defaultWorkstationId: asWorkstationId('ws-p4'),
      passwordHash: DEMO_PASSWORD_HASH,
      isActive: true,
      mustChangePassword: false,
    },
  ];

  return { brands, desks, workstations, bays, operators };
}

// --- Profilo real: officina di Bari ---------------------------------------------------------

/**
 * Marchi delle prenotazioni di Bari (off_marche di Infinity, prenotazioni degli ultimi 120 giorni al
 * 2026-09-16: Fiat 696, Citroën 556, Jeep 315, Peugeot 273, DS 185, Lancia 152, Alfa Romeo 116,
 * EMC 53, Leapmotor 35, XEV 14, Opel 4) più «Altri marchi» per i casi sporadici (Hyundai, Foton,
 * Mini, Mercedes…). I codici coincidono con quelli che l'adapter ricava dalla descrizione Infinity
 * (`brandCodeFromDescription`); i prefissi valgono solo con CODE_SEQUENCE_SCOPE=BRAND.
 */
const REAL_BRANDS: readonly Brand[] = [
  brand('FIAT', 'Fiat', 'F'),
  brand('LANCIA', 'Lancia', 'L'),
  brand('ALFA_ROMEO', 'Alfa Romeo', 'A'),
  brand('JEEP', 'Jeep', 'J'),
  brand('EMC', 'EMC', 'E'),
  brand('LEAPMOTOR', 'Leapmotor', 'M'),
  brand('PEUGEOT', 'Peugeot', 'P'),
  brand('CITROEN', 'Citroën', 'C'),
  brand('DS', 'DS Automobiles', 'D'),
  brand('OPEL', 'Opel', 'O'),
  brand('XEV', 'XEV', 'X'),
  brand(FALLBACK_BRAND_CODE, 'Altri marchi', 'Z'),
];

/**
 * Marchi per area come li disegna il planning: gli accettatori Giglione, Rusigniuolo e Marzulli
 * lavorano Fiat, Lancia, Alfa Romeo, Jeep, EMC e Leapmotor (sportelli A e B, FCA); Brindicci, Cioce
 * e Croce lavorano Peugeot, Citroën, DS e XEV (sportelli C e D, PSA). «Altri marchi» è su entrambe:
 * se lo prende chi è libero.
 */
const REAL_FCA_BRANDS: readonly string[] = [
  'FIAT',
  'LANCIA',
  'ALFA_ROMEO',
  'JEEP',
  'EMC',
  'LEAPMOTOR',
  FALLBACK_BRAND_CODE,
];
const REAL_PSA_BRANDS: readonly string[] = [
  'PEUGEOT',
  'CITROEN',
  'DS',
  'OPEL',
  'XEV',
  FALLBACK_BRAND_CODE,
];

/** Token del display di uno sportello: HMAC del segreto, 32 caratteri esadecimali, stabile fra i riavvii. */
export function displayTokenFor(secret: string, bayCode: string): string {
  return createHmac('sha256', secret).update(`display:${bayCode}`).digest('hex').slice(0, 32);
}

/**
 * Hash della password dell'amministratore dall'ambiente: `base64:<hash>` (come lo stampa lo script,
 * perché il formato scrypt contiene "$") oppure l'hash scrypt così com'è. Null se assente o non scrypt.
 */
export function decodeAdminPasswordHash(raw: string | null): string | null {
  if (raw === null || raw.trim() === '') {
    return null;
  }
  const s = raw.trim();
  const decodificato = s.startsWith('base64:')
    ? Buffer.from(s.slice('base64:'.length), 'base64').toString('utf8').trim()
    : s;
  return decodificato.startsWith('scrypt$') ? decodificato : null;
}

function buildRealSeedData(options: SeedOptions): SeedData {
  const passwordHash = decodeAdminPasswordHash(options.seedAdminPasswordHash);
  if (passwordHash === null) {
    throw new ConfigurationError(
      'SEED_PROFILE=real richiede SEED_ADMIN_PASSWORD_HASH (hash scrypt, anche nella forma base64:…): ' +
        'generarlo con `npm run seed:credenziali`.',
    );
  }
  const secret = options.seedDisplayTokenSecret?.trim() ?? '';
  if (secret.length < SEED_DISPLAY_TOKEN_SECRET_MIN_LENGTH) {
    throw new ConfigurationError(
      `SEED_PROFILE=real richiede SEED_DISPLAY_TOKEN_SECRET di almeno ${SEED_DISPLAY_TOKEN_SECRET_MIN_LENGTH} caratteri: ` +
        'generarlo con `npm run seed:credenziali`.',
    );
  }

  const desks = desksFor(REAL_FCA_BRANDS, REAL_PSA_BRANDS);
  const bays = baysFor((letter) => displayTokenFor(secret, letter));
  const workstations = workstationsAD();

  const operators: Operator[] = [
    {
      id: asOperatorId('op-admin'),
      username: 'admin',
      displayName: 'Amministratore',
      role: 'ADMIN',
      deskIds: desks.map((d) => d.id),
      defaultWorkstationId: null,
      passwordHash,
      isActive: true,
      // La password provvisoria la conosce anche chi l'ha generata: va cambiata al primo accesso.
      mustChangePassword: true,
    },
  ];

  return { brands: REAL_BRANDS, desks, workstations, bays, operators };
}
