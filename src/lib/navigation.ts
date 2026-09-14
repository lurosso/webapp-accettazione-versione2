// Destinazioni dell'area operatore in base al ruolo. Un solo punto di verità, usato dalla radice
// del sito e dal login: senza questo, un responsabile o un amministratore finirebbe sempre sulla
// dashboard dell'accettatore, come se non avesse una propria area.
import type { OperatorRole } from '@/domain/entities/operator';

/** Pagina iniziale di ogni ruolo dopo il login o aprendo la radice del sito. */
export function homePathForRole(role: OperatorRole): string {
  switch (role) {
    case 'ADMIN':
      return '/admin';
    case 'SUPERVISOR':
      return '/manager';
    case 'ADVISOR':
      return '/accettazione';
    case 'KIOSK':
      // Un dispositivo non ha una "dashboard": la sua casa è il tabellone della sala.
      return '/display/sala-attesa';
  }
}

/** Vista del check-in veicolo (tablet, a tutto schermo); fino al 2026-09-14 si chiamava `/tablet`. */
export const CHECK_IN_PATH = '/check-in';

/**
 * Schermata di check-in di una pratica. Vive dentro la vista `/check-in`, che è la stessa usata
 * sul piazzale: il parametro dice quale pratica aprire, così ci si arriva dalla dashboard senza
 * duplicare la schermata.
 */
export function checkInPath(appointmentId: string): string {
  return `${CHECK_IN_PATH}?pratica=${encodeURIComponent(appointmentId)}`;
}

/** Nome del parametro letto dalla pagina tablet. */
export const CHECK_IN_PARAM = 'pratica';

/** Aree protette dell'applicazione. */
export type ProtectedArea = 'accettazione' | 'check-in' | 'manager' | 'admin' | 'sistema';

/** Ruoli ammessi su ciascuna area; un solo elenco, usato dalle pagine e dalla navigazione. */
export const AREA_ROLES: Record<ProtectedArea, readonly OperatorRole[]> = {
  accettazione: ['ADVISOR', 'SUPERVISOR', 'ADMIN'],
  'check-in': ['ADVISOR', 'SUPERVISOR', 'ADMIN'],
  manager: ['SUPERVISOR', 'ADMIN'],
  admin: ['ADMIN'],
  sistema: ['ADVISOR', 'SUPERVISOR', 'ADMIN'],
};

/** True se il ruolo può accedere all'area. */
export function canAccess(area: ProtectedArea, role: OperatorRole): boolean {
  return AREA_ROLES[area].includes(role);
}

/** Pagine da cui non ha senso "tornare" dopo il cambio password. */
const NON_DESTINATIONS = ['/cambia-password', '/login'];

/**
 * Dove portare l'operatore dopo aver salvato la nuova password: la pagina che stava aprendo,
 * oppure la home del suo ruolo se non c'era (o se era il login o il cambio password stesso).
 * Non restituisce mai una pagina che lo lascerebbe dov'è.
 */
export function destinationAfterPasswordChange(
  raw: string | string[] | undefined,
  role: OperatorRole,
): string {
  const path = safeInternalPath(raw, '/');
  if (path === '/' || NON_DESTINATIONS.some((p) => path.startsWith(p))) {
    return homePathForRole(role);
  }
  return path;
}

/** Percorso interno sicuro per i redirect (mai verso un altro sito). */
export function safeInternalPath(raw: string | string[] | undefined, fallback: string): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || !value.startsWith('/') || value.startsWith('//')) {
    return fallback;
  }
  return value;
}
