// Costanti di progetto (valori di default; alcuni sono sovrascrivibili via env).
// Le regole di dominio (es. CODE_PAD_LENGTH) vivono in src/domain, non qui.

/** Fuso orario dell'officina (default di `APP_TIMEZONE`). */
export const TIMEZONE = 'Europe/Rome';

/** Ora locale della sincronizzazione giornaliera dell'agenda (default di `SYNC_HOUR_LOCAL`). */
export const DEFAULT_SYNC_HOUR_LOCAL = '06:00';

/** Prefisso del codice progressivo F001 (default di `CODE_PREFIX`). */
export const DEFAULT_CODE_PREFIX = 'F';

/**
 * Cartella dei file caricati quando lo storage media è `local` (env MEDIA_STORAGE_DIR).
 * Sta sotto `.data/` come lo snapshot della giornata: è stato locale dell'officina, non codice,
 * e come tale resta fuori dal repository.
 */
export const DEFAULT_MEDIA_DIR = '.data/uploads';

/** Numero di campate d'accettazione con display (usata da M1 per la scelta campata e da M4 per i display). */
export const BAY_COUNT = 4;

/** Intervalli di polling (ms) per tipo di client (usata dagli hook di M1, M2 e M4). */
export const POLLING_MS = {
  dashboard: 3000,
  display: 2000,
  portal: 5000,
} as const;

/** Dopo quanti ms senza aggiornamenti la UI mostra "Dati non aggiornati" (usata da M1, `useStaleIndicator`). */
export const STALE_WARNING_MS = 15000;

/**
 * Limiti anti-abuso dell'API pubblica del portale cliente (richieste al minuto).
 * Devono restare SOPRA il traffico legittimo generato dal polling della pagina di stato
 * (`60_000 / POLLING_MS.portal` richieste al minuto per ogni scheda aperta), altrimenti il
 * portale bloccherebbe i clienti invece degli abusi: la coerenza è verificata da un test.
 * `perIp` regge molte schede dietro lo stesso indirizzo (wifi ospiti dell'officina),
 * `perPlate` consente il polling di due dispositivi sulla stessa vettura.
 */
export const PUBLIC_STATUS_RATE_LIMIT = {
  perIp: 240,
  perPlate: 30,
  windowMs: 60_000,
} as const;

/** Durata della segnalazione "libero" sul display dopo un Completato (usata da M4, `BayDisplayView`). */
export const RELEASING_DISPLAY_MS = 20000;

/** Salti oltre i quali si genera un'anomalia EXCESSIVE_SKIPS verso il CRM (usata da M6, `AnomalyReporter`). */
export const MAX_SKIPS_BEFORE_ANOMALY = 3;

/**
 * Minuti di tolleranza prima di considerare un cliente in ritardo nella dashboard.
 * Un cliente che arriva pochi minuti dopo l'orario non è un assente: sotto questa soglia la
 * pratica resta nella coda normale. Alzare il valore se il blocco "in ritardo" si riempie troppo.
 */
export const LATE_GRACE_MINUTES = 10;

/** Dopo quanti ms un job di notifica IN_FLIGHT è considerato orfano (crash) e riprocessabile. */
export const NOTIFICATION_IN_FLIGHT_STALE_MS = 5 * 60_000;
