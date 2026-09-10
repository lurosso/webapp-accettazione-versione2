// Barrel dei mock. Importato SOLO da services/factory.ts e config/container.ts:
// la UI e i servizi applicativi non devono mai conoscere queste classi (Regola d'Oro).

export * from './InfinityServiceMock';
export * from './SpokiServiceMock';
export * from './SmsHostingServiceMock';
export * from './CrmServiceMock';
export * from './SystemClock';
export * from './FixedClock';
export * from './UuidIdGenerator';
export * from './SequentialIdGenerator';
export * from './ConsoleLogger';
export * from './InProcessEventBus';
export * from './MediaStorageMock';
