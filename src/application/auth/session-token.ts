// Firma e verifica del JWT di sessione (HS256 con `jose`). Funzioni pure: nessun repository,
// così il proxy Next.js può controllare il cookie senza costruire il container.
import { SignJWT, jwtVerify } from 'jose';
import type { OperatorRole } from '@/domain/entities/operator';
import { domainError, type DomainError } from '@/domain/errors';
import { asDeskId, asOperatorId, asWorkstationId } from '@/domain/ids';
import { err, ok, type Result } from '@/domain/result';
import { isoDateTime } from '@/domain/value-objects/iso-date';
import type { Session } from './IAuthService';

const ALGORITHM = 'HS256';
const ISSUER = 'webapp-accettazione';
const ROLES: readonly OperatorRole[] = ['ADVISOR', 'SUPERVISOR', 'ADMIN'];

function isOperatorRole(v: unknown): v is OperatorRole {
  return typeof v === 'string' && (ROLES as readonly string[]).includes(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function encodeSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/** Firma la sessione: `sub` = operatorId, scadenza da `session.expiresAt`. */
export async function signSessionToken(session: Session, secret: string): Promise<string> {
  return new SignJWT({
    username: session.username,
    displayName: session.displayName,
    role: session.role,
    workstationId: session.workstationId,
    deskIds: [...session.deskIds],
  })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuer(ISSUER)
    .setSubject(session.operatorId)
    .setIssuedAt(new Date(session.issuedAt))
    .setExpirationTime(new Date(session.expiresAt))
    .sign(encodeSecret(secret));
}

/**
 * Verifica firma, emittente e scadenza e ricostruisce la sessione dai claim.
 * `now` è l'istante di riferimento per la scadenza (dall'`IClock` iniettato; se assente, l'orologio
 * di sistema, come nel proxy). Token scaduto o manomesso → `VALIDATION` (mai eccezione).
 */
export async function verifySessionToken(
  token: string,
  secret: string,
  now?: Date,
): Promise<Result<Session, DomainError>> {
  try {
    const { payload } = await jwtVerify(token, encodeSecret(secret), {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      ...(now === undefined ? {} : { currentDate: now }),
    });
    const { sub, iat, exp, username, displayName, role, workstationId, deskIds } = payload;
    if (
      typeof sub !== 'string' ||
      typeof iat !== 'number' ||
      typeof exp !== 'number' ||
      typeof username !== 'string' ||
      typeof displayName !== 'string' ||
      !isOperatorRole(role) ||
      typeof workstationId !== 'string' ||
      !isStringArray(deskIds)
    ) {
      return err(domainError('VALIDATION', 'Sessione non valida: claim mancanti o malformati.'));
    }
    return ok({
      operatorId: asOperatorId(sub),
      username,
      displayName,
      role,
      workstationId: asWorkstationId(workstationId),
      deskIds: deskIds.map(asDeskId),
      issuedAt: isoDateTime(new Date(iat * 1000)),
      expiresAt: isoDateTime(new Date(exp * 1000)),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.name : 'errore sconosciuto';
    return err(
      domainError('VALIDATION', 'Sessione scaduta o non valida: effettuare di nuovo il login.', {
        reason,
      }),
    );
  }
}
