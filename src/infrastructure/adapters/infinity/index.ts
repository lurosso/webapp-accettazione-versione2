// Barrel dell'adapter Infinity via ODBC. Importato SOLO da services/factory.ts, config/container.ts
// e dai test (Regola d'Oro): sync, casi d'uso e dashboard parlano con `IInfinityService`.

export * from './infinity-odbc-config';
export * from './infinity-planning-query';
export * from './InfinityServiceOdbc';
export * from './OdbcClient';
