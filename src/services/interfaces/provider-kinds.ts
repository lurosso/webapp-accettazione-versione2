// Tipi neutri per la selezione delle implementazioni via env. Vivono qui (e non nei
// factory) così `config/env.ts` non deve importare nulla da `services/factory.ts`,
// `repositories/factory.ts` o `services/mocks/*`: nessun ciclo di import e la regola
// "solo i factory e il container conoscono i mock" resta vera anche a livello di tipi.

/** Implementazione di una porta esterna selezionabile via `<X>_PROVIDER` / `SERVICES_PROVIDER`. */
export type ProviderKind = 'mock' | 'real';

/** Implementazione della persistenza selezionabile via `REPOSITORY_PROVIDER`. */
export type RepositoryProvider = 'memory' | 'prisma';

/**
 * Modalità del servizio Spoki reale (`SPOKI_MODE`): `simulation` non chiama nulla e registra i
 * payload (nessun credito WhatsApp consumato), `live` chiama le automazioni Spoki.
 */
export type SpokiMode = 'simulation' | 'live';

/** Implementazione dello storage media selezionabile via `MEDIA_STORAGE_PROVIDER`. */
export type MediaStorageProvider = 'memory' | 'local' | 'blob';
