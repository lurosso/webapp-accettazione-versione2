// Traduzione degli errori di dominio (valori `Result`) in risposte HTTP JSON uniformi.
// Il client legge sempre `{ error: { code, message, details } }`.
import { NextResponse } from 'next/server';
import type { DomainError, DomainErrorCode } from '@/domain/errors';

/** Corpo JSON di ogni risposta di errore dell'API. */
export interface ApiErrorBody {
  readonly error: {
    readonly code: DomainErrorCode | 'UNAUTHORIZED' | 'FORBIDDEN' | 'BAD_REQUEST';
    readonly message: string;
    readonly details?: Readonly<Record<string, unknown>>;
  };
}

/** Stato HTTP per ogni codice di dominio. */
export function httpStatusFor(code: DomainErrorCode): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404;
    case 'VALIDATION':
    case 'NO_RECIPIENT':
      return 400;
    case 'VERSION_CONFLICT':
    case 'INVALID_TRANSITION':
    case 'BAY_BUSY':
      return 409;
    case 'NOT_IMPLEMENTED':
      return 501;
    case 'INTERNAL':
      return 500;
  }
}

/** Risposta JSON da un `DomainError`. */
export function domainErrorResponse(
  error: DomainError,
  headers?: Record<string, string>,
): NextResponse<ApiErrorBody> {
  const body: ApiErrorBody = {
    error:
      error.details === undefined
        ? { code: error.code, message: error.message }
        : { code: error.code, message: error.message, details: error.details },
  };
  return NextResponse.json(body, { status: httpStatusFor(error.code), headers: headers ?? {} });
}

/** 401: sessione assente o non valida. */
export function unauthorizedResponse(
  message = 'Sessione assente o scaduta: effettuare il login.',
): NextResponse<ApiErrorBody> {
  return NextResponse.json({ error: { code: 'UNAUTHORIZED', message } }, { status: 401 });
}

/** 403: operatore autenticato ma senza il ruolo richiesto. */
export function forbiddenResponse(
  message = 'Operazione non consentita per il ruolo corrente.',
): NextResponse<ApiErrorBody> {
  return NextResponse.json({ error: { code: 'FORBIDDEN', message } }, { status: 403 });
}

/** 400: corpo o parametri della richiesta non validi (Zod). */
export function badRequestResponse(
  message: string,
  details?: Readonly<Record<string, unknown>>,
): NextResponse<ApiErrorBody> {
  const error =
    details === undefined
      ? { code: 'BAD_REQUEST' as const, message }
      : { code: 'BAD_REQUEST' as const, message, details };
  return NextResponse.json({ error }, { status: 400 });
}
