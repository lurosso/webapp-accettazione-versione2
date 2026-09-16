// Token di accesso al portale cliente, uno per pratica, senza login e senza nulla da salvare.
//
// Il link inviato via WhatsApp è `/portal?targa=AB123CD&t=<token>`: il token è l'HMAC dell'id
// della pratica con il segreto del server, quindi non si indovina dalla targa né dal codice F041
// e non richiede una colonna in più. Chi ha solo la targa (QR in officina) accede comunque in
// lettura, con i limiti di frequenza dell'API pubblica; il token evita anche quelli, perché chi
// lo possiede ha ricevuto il messaggio.
//
// Solo lato server (node:crypto): mai importare da componenti client.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AppointmentId } from '@/domain/ids';

/** Lunghezza del token: 12 caratteri esadecimali (48 bit), leggibile in un link e non enumerabile. */
const TOKEN_LENGTH = 12;

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
