// Logger strutturato con prefissi componibili (es. "[MOCK][Spoki]").

/** Livelli di log in ordine crescente di gravità. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Contesto strutturato allegato a una riga di log. */
export type LogContext = Readonly<Record<string, unknown>>;

/** Logger iniettato in mock e servizi applicativi. */
export interface ILogger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  /** Nuovo logger con prefisso concatenato a quello corrente. */
  child(prefix: string): ILogger;
}
