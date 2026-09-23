// Token di accesso al portale cliente, uno per pratica, senza login e senza nulla da salvare.
//
// Lo smart link inviato via WhatsApp è `/portal/<token>` (accettato anche `/portal?t=<token>`
// e, con la targa, `/portal?targa=AB123CD&t=<token>`): il token è l'HMAC dell'id
// della pratica con il segreto del server, quindi non si indovina dalla targa né dal codice F041
// e non richiede una colonna in più. Chi ha solo la targa (QR in officina) accede comunque in
// lettura, con i limiti di frequenza dell'API pubblica; il token evita anche quelli, perché chi
// lo possiede ha ricevuto il messaggio.
//
// Solo lato server (node:crypto): mai importare da componenti client.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AppointmentId } from '@/domain/ids';

/** Lunghezza del token: 16 caratteri esadecimali (64 bit), leggibile in un link e non enumerabile. */
export const TOKEN_LENGTH = 16;

/** Forma di un token valido: solo esadecimale minuscolo, lunghezza esatta. */
export const PORTAL_TOKEN_PATTERN = /^[0-9a-f]{16}$/;

/** True se la stringa ha la forma di un token del portale (non dice se corrisponde a una pratica). */
export function isPortalToken(candidate: string): boolean {
  return PORTAL_TOKEN_PATTERN.test(candidate);
}

/**
 * Chiave dei token del portale, derivata dal segreto di sessione con un'etichetta fissa: stessa
 * variabile d'ambiente, chiavi diverse per cookie e link. Cambiare il segreto invalida i link
 * inviati: va fatto sapendolo.
 */
export function derivePortalTokenKey(sessionSecret: string): string {
  return createHmac('sha256', sessionSecret).update('portal-token-v1').digest('hex');
}

export interface PortalTokenFactory {
  /** Token della pratica, sempre lo stesso finché non cambia il segreto del server. */
  forAppointment(appointmentId: AppointmentId): string;
  /** Confronto a tempo costante con quello fornito dal cliente. */
  matches(appointmentId: AppointmentId, candidate: string): boolean;
}

export function createPortalTokenFactory(secret: string): PortalTokenFactory {
  if (secret.trim() === '') {
    throw new Error('Il segreto dei token del portale non può essere vuoto.');
  }
  const forAppointment = (appointmentId: AppointmentId): string =>
    createHmac('sha256', secret)
      .update(`portal:${appointmentId}`)
      .digest('hex')
      .slice(0, TOKEN_LENGTH);
  return {
    forAppointment,
    matches(appointmentId, candidate) {
      const atteso = Buffer.from(forAppointment(appointmentId), 'utf8');
      const fornito = Buffer.from(candidate.trim().toLowerCase(), 'utf8');
      return atteso.length === fornito.length && timingSafeEqual(atteso, fornito);
    },
  };
}
