// Dati di riferimento (marchi, sportelli, postazioni, campate, operatori), in due profili:
// - demo (predefinito): officina di prova con 7 marchi, 3 sportelli, 5 operatori con password
//   "plain:demo" e token display prevedibili. SOLO sviluppo: il container li rifiuta appena un
//   provider è reale o NODE_ENV=production.
// - real (SEED_PROFILE=real): l'officina Autoclub di Bari come emerge dal planning di Infinity
//   (prenotazioni maggio-settembre 2026): due sportelli per marchi, i marchi veri più «Altri marchi»
//   per quelli sporadici (Hyundai, Foton…), un solo account amministratore con hash scrypt da
//   SEED_ADMIN_PASSWORD_HASH e password da cambiare al primo accesso; gli accettatori li crea
//   l'amministratore da /admin. I token dei display derivano da SEED_DISPLAY_TOKEN_SECRET (HMAC),
//   così non stanno nel repository. I tre valori si generano con `npm run seed:credenziali`.

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

/** Costruisce i dati demo (7 brand, 3 sportelli, 4 postazioni, 4 campate, 5 operatori). */
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

  const desks: Desk[] = [
    {
      id: asDeskId('desk-s1'),
      code: 'S1',
      name: 'Sportello Stellantis Italia',
      brandIds: [brandId('FIAT'), brandId('LANCIA')],
      isActive: true,
    },
    {
      id: asDeskId('desk-s2'),
      code: 'S2',
      name: 'Sportello Jeep / Alfa Romeo',
      brandIds: [brandId('JEEP'), brandId('ALFA_ROMEO')],
      isActive: true,
    },
    {
      id: asDeskId('desk-s3'),
      code: 'S3',
      name: 'Sportello Peugeot / Citroën / Opel',
      brandIds: [brandId('PEUGEOT'), brandId('CITROEN'), brandId('OPEL')],
      isActive: true,
    },
  ];

  const bays: Bay[] = ([1, 2, 3, 4] as const).map((n) => ({
    id: asBayId(`bay-c${n}`),
    code: `C${n}`,
    number: n,
    name: `Accettazione ${n}`,
    // Token demo prevedibile: nel profilo real deriva da SEED_DISPLAY_TOKEN_SECRET.
    displayToken: `${DEMO_DISPLAY_TOKEN_PREFIX}token-c${n}`,
    isActive: true,
  }));

  const workstations: Workstation[] = [
    {
      id: asWorkstationId('ws-p1'),
      code: 'P1',
      name: 'Accettazione 1',
      deskId: asDeskId('desk-s1'),
      defaultBayId: asBayId('bay-c1'),
    },
    {
      id: asWorkstationId('ws-p2'),
      code: 'P2',
      name: 'Accettazione 2',
      deskId: asDeskId('desk-s1'),
      defaultBayId: asBayId('bay-c2'),
    },
    {
      id: asWorkstationId('ws-p3'),
      code: 'P3',
      name: 'Accettazione 3',
      deskId: asDeskId('desk-s2'),
      defaultBayId: asBayId('bay-c3'),
    },
    {
      id: asWorkstationId('ws-p4'),
      code: 'P4',
      name: 'Accettazione 4',
      deskId: asDeskId('desk-s3'),
      defaultBayId: asBayId('bay-c4'),
    },
  ];

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
      deskIds: [asDeskId('desk-s1')],
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
      deskIds: [asDeskId('desk-s2')],
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
      deskIds: [asDeskId('desk-s3')],
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
 * Sportelli di Bari come li disegna il planning: gli accettatori Giglione, Rusigniuolo e Marzulli
 * lavorano Fiat, Lancia, Alfa Romeo, Jeep, EMC e Leapmotor; Brindicci, Cioce e Croce lavorano
 * Peugeot, Citroën, DS e XEV. «Altri marchi» è su entrambi: se lo prende chi è libero.
 */
const REAL_DESK_BRANDS: Readonly<Record<'S1' | 'S2', readonly string[]>> = {
  S1: ['FIAT', 'LANCIA', 'ALFA_ROMEO', 'JEEP', 'EMC', 'LEAPMOTOR', FALLBACK_BRAND_CODE],
  S2: ['PEUGEOT', 'CITROEN', 'DS', 'OPEL', 'XEV', FALLBACK_BRAND_CODE],
};

/** Token del display di una campata: HMAC del segreto, 32 caratteri esadecimali, stabile fra i riavvii. */
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

  const desks: Desk[] = [
    {
      id: asDeskId('desk-s1'),
      code: 'S1',
      name: 'Sportello Stellantis Italia',
      brandIds: REAL_DESK_BRANDS.S1.map(brandId),
      isActive: true,
    },
    {
      id: asDeskId('desk-s2'),
      code: 'S2',
      name: 'Sportello Peugeot / Citroën / DS',
      brandIds: REAL_DESK_BRANDS.S2.map(brandId),
      isActive: true,
    },
  ];

  const bays: Bay[] = ([1, 2, 3, 4] as const).map((n) => ({
    id: asBayId(`bay-c${n}`),
    code: `C${n}`,
    number: n,
    name: `Accettazione ${n}`,
    displayToken: displayTokenFor(secret, `C${n}`),
    isActive: true,
  }));

  // Quattro postazioni fisiche: le prime due sullo sportello Stellantis Italia, le altre su Peugeot/Citroën/DS.
  const workstations: Workstation[] = ([1, 2, 3, 4] as const).map((n) => ({
    id: asWorkstationId(`ws-p${n}`),
    code: `P${n}`,
    name: `Accettazione ${n}`,
    deskId: asDeskId(n <= 2 ? 'desk-s1' : 'desk-s2'),
    defaultBayId: asBayId(`bay-c${n}`),
  }));

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
