// Factory della persistenza: unico importatore di repositories/in-memory e repositories/prisma.
// Seleziona l'implementazione da env.repositoryProvider.
//
// `prisma` è la persistenza vera dell'officina: SQLite in un file, che sopravvive al riavvio. I
// dati di riferimento (marchi, sportelli, postazioni, campate) restano dal seed anche in questa
// modalità: sono configurazione, non stato, e cambiano con un rilascio, non durante il turno.
//
// `memory` resta per i test e per le dimostrazioni usa e getta: è il "double" della regola
// Mock-First, e l'`InMemoryStore` è DEPRECATO come persistenza dell'officina — tutto quello che
// contiene sparisce al riavvio del processo.

import type { AppEnv } from '@/config/env';
import type { IClock } from '@/services/interfaces/IClock';
import {
  InMemoryAppointmentRepository,
  InMemoryCrmOutboxRepository,
  InMemoryMediaRepository,
  InMemoryNotificationRepository,
  InMemoryOperatorRepository,
  InMemoryReferenceDataRepository,
  InMemoryStore,
  InMemorySyncRunRepository,
  InMemoryWorkstationClaimRepository,
} from './in-memory';
import type { Repositories } from './interfaces';
import {
  getSharedPrismaClient,
  PrismaAppointmentRepository,
  PrismaCrmOutboxRepository,
  PrismaMediaRepository,
  PrismaNotificationRepository,
  PrismaOperatorRepository,
  PrismaSyncRunRepository,
  PrismaWorkstationClaimRepository,
} from './prisma';

/** Implementazioni di persistenza selezionabili via REPOSITORY_PROVIDER (definito in services/interfaces/provider-kinds). */
export type { RepositoryProvider } from '@/services/interfaces/provider-kinds';

/** Dipendenze del factory; `store` iniettato nei test per isolare lo stato. */
export interface RepositoryDeps {
  readonly clock: IClock;
  readonly store?: InMemoryStore;
}

/** Costruisce l'insieme dei repository in base all'ambiente. */
export function createRepositories(env: AppEnv, deps: RepositoryDeps): Repositories {
  const store = deps.store ?? InMemoryStore.getGlobal();
  switch (env.repositoryProvider) {
    case 'memory':
      return {
        appointments: new InMemoryAppointmentRepository(store, deps.clock),
        operators: new InMemoryOperatorRepository(store),
        referenceData: new InMemoryReferenceDataRepository(store),
        notifications: new InMemoryNotificationRepository(store),
        syncRuns: new InMemorySyncRunRepository(store),
        crmOutbox: new InMemoryCrmOutboxRepository(store),
        media: new InMemoryMediaRepository(store),
        workstationClaims: new InMemoryWorkstationClaimRepository(store),
      };
    case 'prisma': {
      const db = getSharedPrismaClient(env.databaseUrl);
      return {
        appointments: new PrismaAppointmentRepository(db, deps.clock),
        // Gli operatori del seed (già caricati nello store dal container) entrano nel database solo
        // al primo avvio, a tabella vuota: da lì in avanti comanda il database.
        operators: new PrismaOperatorRepository(db, [...store.state.operators.values()]),
        referenceData: new InMemoryReferenceDataRepository(store),
        notifications: new PrismaNotificationRepository(db),
        syncRuns: new PrismaSyncRunRepository(db),
        crmOutbox: new PrismaCrmOutboxRepository(db),
        media: new PrismaMediaRepository(db),
        workstationClaims: new PrismaWorkstationClaimRepository(db),
      };
    }
  }
}
