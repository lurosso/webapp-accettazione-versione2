// Factory della persistenza: unico importatore di repositories/in-memory (e domani prisma/).
// Seleziona l'implementazione da env.repositoryProvider; il ramo prisma fallisce subito
// all'avvio con un messaggio esplicito (fail-fast), mai a metà giornata.

import type { AppEnv } from '@/config/env';
import { NotImplementedError } from '@/domain/errors';
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
} from './in-memory';
import type { Repositories } from './interfaces';

/** Implementazioni di persistenza selezionabili via REPOSITORY_PROVIDER (definito in services/interfaces/provider-kinds). */
export type { RepositoryProvider } from '@/services/interfaces/provider-kinds';

/** Dipendenze del factory; `store` iniettato nei test per isolare lo stato. */
export interface RepositoryDeps {
  readonly clock: IClock;
  readonly store?: InMemoryStore;
}

/** Costruisce l'insieme dei repository in base all'ambiente. */
export function createRepositories(env: AppEnv, deps: RepositoryDeps): Repositories {
  switch (env.repositoryProvider) {
    case 'memory': {
      const store = deps.store ?? InMemoryStore.getGlobal();
      return {
        appointments: new InMemoryAppointmentRepository(store, deps.clock),
        operators: new InMemoryOperatorRepository(store),
        referenceData: new InMemoryReferenceDataRepository(store),
        notifications: new InMemoryNotificationRepository(store),
        syncRuns: new InMemorySyncRunRepository(store),
        crmOutbox: new InMemoryCrmOutboxRepository(store),
        media: new InMemoryMediaRepository(store),
      };
    }
    case 'prisma':
      throw new NotImplementedError(
        'Persistenza "prisma" non ancora disponibile (post-M7). Imposta REPOSITORY_PROVIDER=memory.',
      );
  }
}
