// Errori di dominio tipizzati: gli errori attesi sono VALORI (mai eccezioni),
// così ogni chiamante è costretto dal compilatore a gestirli.

/** Codici degli errori di dominio; la mappatura HTTP avviene nei Route Handler (404/409/422). */
export type DomainErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'VERSION_CONFLICT'
  | 'BAY_BUSY'
  | 'VALIDATION'
  | 'NO_RECIPIENT'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL';

/** Errore di dominio: codice stabile, messaggio in italiano e dettagli opzionali per la UI/log. */
export interface DomainError {
  readonly code: DomainErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

/**
 * Costruisce un `DomainError`. I dettagli vengono inclusi solo se forniti
 * (compatibile con `exactOptionalPropertyTypes`).
 */
export function domainError(
  code: DomainErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): DomainError {
  return details === undefined ? { code, message } : { code, message, details };
}

/**
 * Eccezione riservata al fail-fast dei factory quando si richiede un adapter
 * non ancora disponibile (ramo `real`). NON va usata per errori attesi a runtime.
 */
export class NotImplementedError extends Error {
  override readonly name = 'NotImplementedError';

  constructor(message: string) {
    super(message);
  }
}

/**
 * Eccezione riservata al fail-fast del composition root quando la configurazione è
 * incoerente o pericolosa (es. credenziali demo con provider reali o in produzione).
 * Viene lanciata all'avvio, mai a metà giornata.
 */
export class ConfigurationError extends Error {
  override readonly name = 'ConfigurationError';

  constructor(message: string) {
    super(message);
  }
}
