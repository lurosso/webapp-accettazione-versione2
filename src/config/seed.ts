// Dati di configurazione demo: marchi, sportelli, postazioni, campate e operatori.
// ATTENZIONE: le password degli operatori sono in chiaro ("plain:demo") SOLO per lo
// sviluppo locale; in M1 verranno sostituite da hash scrypt e un guard rifiuterà
// SERVICES_PROVIDER=real con credenziali demo attive.

import type { Bay } from '@/domain/entities/bay';
import type { Brand } from '@/domain/entities/brand';
import type { Desk } from '@/domain/entities/desk';
import type { Operator } from '@/domain/entities/operator';
import type { Workstation } from '@/domain/entities/workstation';
import { asBayId, asBrandId, asDeskId, asOperatorId, asWorkstationId } from '@/domain/ids';

/** Insieme dei dati di riferimento caricati nello store alla prima creazione del container. */
export interface SeedData {
  readonly brands: readonly Brand[];
  readonly desks: readonly Desk[];
  readonly workstations: readonly Workstation[];
  readonly bays: readonly Bay[];
  readonly operators: readonly Operator[];
}

/** Prefisso che marca una password demo in chiaro (SOLO sviluppo; il container la rifiuta con provider reali). */
export const DEMO_PASSWORD_PREFIX = 'plain:';

/** Password demo in chiaro, riconoscibile dal prefisso "plain:" (SOLO sviluppo). */
export const DEMO_PASSWORD_HASH = `${DEMO_PASSWORD_PREFIX}demo`;

/** Prefisso dei token display demo (SOLO sviluppo; in M1 i token arrivano da env). */
export const DEMO_DISPLAY_TOKEN_PREFIX = 'display-demo-';

/** Indica se il seed contiene ancora credenziali o token demo prevedibili. */
export function hasDemoCredentials(seed: SeedData): boolean {
  return (
    seed.operators.some((o) => o.passwordHash.startsWith(DEMO_PASSWORD_PREFIX)) ||
    seed.bays.some((b) => b.displayToken.startsWith(DEMO_DISPLAY_TOKEN_PREFIX))
  );
}

/** Costruisce i dati demo (7 brand, 3 sportelli, 4 postazioni, 4 campate, 5 operatori). */
export function buildSeedData(): SeedData {
  const brand = (code: string, name: string, codePrefix: string): Brand => ({
    id: asBrandId(`brand-${code.toLowerCase()}`),
    code,
    name,
    codePrefix,
    colorToken: `brand-${code.toLowerCase().replace(/_/g, '-')}`,
    isActive: true,
  });

  const brands: Brand[] = [
    brand('FIAT', 'Fiat', 'F'),
    brand('JEEP', 'Jeep', 'J'),
    brand('ALFA_ROMEO', 'Alfa Romeo', 'A'),
    brand('LANCIA', 'Lancia', 'L'),
    brand('PEUGEOT', 'Peugeot', 'P'),
    brand('CITROEN', 'Citroën', 'C'),
    brand('OPEL', 'Opel', 'O'),
  ];
  const brandId = (code: string): Brand['id'] => asBrandId(`brand-${code.toLowerCase()}`);

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
    // Token demo prevedibile: in produzione va generato e conservato fuori dal repo.
    displayToken: `${DEMO_DISPLAY_TOKEN_PREFIX}token-c${n}`,
    isActive: true,
  }));

  const workstations: Workstation[] = [
    {
      id: asWorkstationId('ws-p1'),
      code: 'P1',
      name: 'Postazione 1',
      deskId: asDeskId('desk-s1'),
      defaultBayId: asBayId('bay-c1'),
    },
    {
      id: asWorkstationId('ws-p2'),
      code: 'P2',
      name: 'Postazione 2',
      deskId: asDeskId('desk-s1'),
      defaultBayId: asBayId('bay-c2'),
    },
    {
      id: asWorkstationId('ws-p3'),
      code: 'P3',
      name: 'Postazione 3',
      deskId: asDeskId('desk-s2'),
      defaultBayId: asBayId('bay-c3'),
    },
    {
      id: asWorkstationId('ws-p4'),
      code: 'P4',
      name: 'Postazione 4',
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
    },
  ];

  return { brands, desks, workstations, bays, operators };
}
