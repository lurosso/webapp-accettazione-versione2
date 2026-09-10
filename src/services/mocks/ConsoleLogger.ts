// Logger su console con prefissi componibili: `${prefix} ${message} ${JSON.stringify(context)}`.
// In deploy sarà sostituito da pino dietro la stessa ILogger.

import type { ILogger, LogContext, LogLevel } from '../interfaces/ILogger';

const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** Serializza il contesto in JSON, tollerando valori non serializzabili (Error, cicli). */
function serializeContext(context: LogContext | undefined): string {
  if (context === undefined) {
    return '';
  }
  try {
    return JSON.stringify(context, (_key, value: unknown) =>
      value instanceof Error ? { name: value.name, message: value.message } : value,
    );
  } catch {
    return '[contesto non serializzabile]';
  }
}

/** Logger su console; `child` concatena i prefissi (es. "[MOCK]" + "[Spoki]" → "[MOCK][Spoki]"). */
export class ConsoleLogger implements ILogger {
  constructor(
    private readonly prefix: string,
    private readonly minLevel: LogLevel = 'debug',
  ) {}

  debug(message: string, context?: LogContext): void {
    this.write('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.write('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.write('warn', message, context);
  }

  error(message: string, context?: LogContext): void {
    this.write('error', message, context);
  }

  child(prefix: string): ILogger {
    return new ConsoleLogger(`${this.prefix}${prefix}`, this.minLevel);
  }

  private write(level: LogLevel, message: string, context: LogContext | undefined): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) {
      return;
    }
    const line = [this.prefix, message, serializeContext(context)]
      .filter((part) => part.length > 0)
      .join(' ');
    switch (level) {
      case 'debug':
        console.debug(line);
        break;
      case 'info':
        console.info(line);
        break;
      case 'warn':
        console.warn(line);
        break;
      case 'error':
        console.error(line);
        break;
    }
  }
}

/** Logger silenzioso per i test. */
export class NoopLogger implements ILogger {
  debug(): void {
    /* silenzioso */
  }

  info(): void {
    /* silenzioso */
  }

  warn(): void {
    /* silenzioso */
  }

  error(): void {
    /* silenzioso */
  }

  child(): ILogger {
    return this;
  }
}
