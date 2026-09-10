// State machine della pratica: tabella esplicita delle transizioni ammesse.
// L'unica transizione "privilegiata" è NO_SHOW → WAITING (arrivo in ritardo, azione
// `reopen`), riservata ai ruoli SUPERVISOR/ADMIN: il controllo del ruolo avviene nel
// servizio applicativo (QueueService), non qui. COMPLETED e CANCELLED sono terminali.
// Azioni corrispondenti alle transizioni: take (→ IN_PROGRESS), skip (→ SKIPPED),
// restore (SKIPPED → WAITING), complete (→ COMPLETED), release (IN_PROGRESS → WAITING),
// no-show (→ NO_SHOW), reopen (NO_SHOW → WAITING); CANCELLED è impostato solo dalla sync.

import type { AppointmentStatus } from './entities/appointment';
import type { DomainError } from './errors';
import { domainError } from './errors';
import type { Result } from './result';
import { err, ok } from './result';

/** Transizioni ammesse da ogni stato (ADR-006). COMPLETED e CANCELLED sono terminali. */
export const ALLOWED_TRANSITIONS: Readonly<Record<AppointmentStatus, readonly AppointmentStatus[]>> =
  {
    WAITING: ['IN_PROGRESS', 'SKIPPED', 'NO_SHOW', 'CANCELLED'],
    SKIPPED: ['IN_PROGRESS', 'WAITING', 'NO_SHOW', 'CANCELLED'],
    IN_PROGRESS: ['COMPLETED', 'WAITING'],
    COMPLETED: [],
    NO_SHOW: ['WAITING'],
    CANCELLED: [],
  };

/** Indica se la transizione `from → to` è ammessa dalla tabella. */
export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Verifica la transizione restituendo `INVALID_TRANSITION` come valore (mai eccezione). */
export function assertTransition(
  from: AppointmentStatus,
  to: AppointmentStatus,
): Result<void, DomainError> {
  if (canTransition(from, to)) {
    return ok(undefined);
  }
  return err(
    domainError('INVALID_TRANSITION', `Transizione non ammessa: ${from} → ${to}.`, {
      from,
      to,
      allowed: ALLOWED_TRANSITIONS[from],
    }),
  );
}
