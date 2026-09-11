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
  }
}

/**
 * Schermata di ispezione di una pratica. Vive dentro l'area tablet (`/tablet`), che è la stessa
 * vista usata sul piazzale: il parametro dice quale pratica aprire, così ci si arriva dalla
 * dashboard senza duplicare la schermata.
 */
export function checkInPath(appointmentId: string): string {
  return `/tablet?pratica=${encodeURIComponent(appointmentId)}`;
}

/** Nome del parametro letto dalla pagina tablet. */
export const CHECK_IN_PARAM = 'pratica';

/** Aree protette dell'applicazione. */
export type ProtectedArea = 'accettazione' | 'tablet' | 'manager' | 'admin' | 'sistema';

/** Ruoli ammessi su ciascuna area; un solo elenco, usato dalle pagine e dalla navigazione. */
export const AREA_ROLES: Record<ProtectedArea, readonly OperatorRole[]> = {
  accettazione: ['ADVISOR', 'SUPERVISOR', 'ADMIN'],
  tablet: ['ADVISOR', 'SUPERVISOR', 'ADMIN'],
  manager: ['SUPERVISOR', 'ADMIN'],
  admin: ['ADMIN'],
  sistema: ['ADVISOR', 'SUPERVISOR', 'ADMIN'],
};

/** True se il ruolo può accedere all'area. */
export function canAccess(area: ProtectedArea, role: OperatorRole): boolean {
  return AREA_ROLES[area].includes(role);
}

/** Percorso interno sicuro per i redirect (mai verso un altro sito). */
export function safeInternalPath(raw: string | string[] | undefined, fallback: string): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || !value.startsWith('/') || value.startsWith('//')) {
    return fallback;
  }
  return value;
}
