// Resilienza verso i sistemi esterni: interruttore di circuito, ripetizione con jitter e i
// decoratori che li applicano alle porte. Importato da services/factory.ts, che avvolge l'adapter
// scelto (mock o reale) senza che casi d'uso e UI se ne accorgano.

export * from './circuit-breaker';
export * from './retry';
export * from './InfinityServiceResilient';
