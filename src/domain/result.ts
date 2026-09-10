// Tipo Result<T, E>: rappresenta successo o fallimento atteso come valore,
// così "l'officina non si blocca mai" diventa una proprietà verificata dal compilatore.

import type { DomainError } from './errors';

/** Esito di un'operazione: `ok: true` con valore oppure `ok: false` con errore tipizzato. */
export type Result<T, E = DomainError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Crea un Result di successo. */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** Crea un Result di fallimento. */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Type guard: il Result è un successo. */
export function isOk<T, E>(r: Result<T, E>): r is { readonly ok: true; readonly value: T } {
  return r.ok;
}

/** Type guard: il Result è un fallimento. */
export function isErr<T, E>(r: Result<T, E>): r is { readonly ok: false; readonly error: E } {
  return !r.ok;
}

/** Trasforma il valore di un Result di successo, propagando l'errore inalterato. */
export function mapResult<T, U, E>(r: Result<T, E>, fn: (v: T) => U): Result<U, E> {
  return r.ok ? { ok: true, value: fn(r.value) } : r;
}

/** Restituisce il valore oppure il fallback fornito in caso di errore. */
export function unwrapOr<T, E>(r: Result<T, E>, fallback: T): T {
  return r.ok ? r.value : fallback;
}
