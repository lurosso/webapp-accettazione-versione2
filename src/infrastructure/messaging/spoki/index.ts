// Barrel dell'integrazione Spoki. Importato SOLO da services/factory.ts e config/container.ts
// (Regola d'Oro): pagine, moduli e casi d'uso parlano con `ISpokiService` e `ISpokiActivityLog`.

export * from './spoki-config';
export * from './SpokiActivityLog';
export * from './SpokiClientAdapter';
export * from './SpokiService';
