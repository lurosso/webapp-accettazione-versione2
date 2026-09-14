// Costanti di progetto (valori di default; alcuni sono sovrascrivibili via env).
// Le regole di dominio (es. CODE_PAD_LENGTH) vivono in src/domain, non qui.

/** Fuso orario dell'officina (default di `APP_TIMEZONE`). */
export const TIMEZONE = 'Europe/Rome';

/** Ora locale della sincronizzazione giornaliera dell'agenda (default di `SYNC_HOUR_LOCAL`). */
export const DEFAULT_SYNC_HOUR_LOCAL = '06:00';

/**
 * Ora locale di fine turno (default di `BUSINESS_DAY_END_TIME`): superata quest'ora la giornata
 * viene chiusa da sola, se non l'ha già chiusa il responsabile. Serve perché l'officina chiude e
 * nessuno resta a premere un pulsante: senza, le pratiche di oggi resterebbero aperte e
 * contaminerebbero la coda di domani.
 */
export const DEFAULT_BUSINESS_DAY_END = '19:00';

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

/**
 * Rinvio degli eventi al CRM (modulo F): attesa progressiva fra un tentativo e il successivo.
 * Un CRM che non risponde non va martellato ogni minuto; allo stesso tempo un guasto di pochi
 * minuti non deve far aspettare il BDC fino al giorno dopo. Dopo l'ultimo intervallo l'evento è
 * dichiarato FAILED e resta al tecnico (pannello Sistema) o al BDC, che comunque ha il lead.
 */
export const CRM_RETRY_BACKOFF_MINUTES = [1, 5, 15, 60, 240] as const;

/** Tentativi massimi di consegna automatica (il primo invio incluso). */
export const CRM_MAX_ATTEMPTS = CRM_RETRY_BACKOFF_MINUTES.length + 1;

/** Tempo massimo concesso a una chiamata verso il CRM prima di considerarla non risposta. */
export const CRM_CALL_TIMEOUT_MS = 5_000;

/** Ogni quanto il processo prova a svuotare la coda di uscita verso il CRM. */
export const CRM_DRAIN_INTERVAL_MS = 60_000;

/** Quanti eventi al massimo per passata: la coda si svuota a ondate, senza bloccare il processo. */
export const CRM_DRAIN_BATCH = 20;

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

/**
 * Limiti di frequenza del login (per indirizzo e per nome utente, finestra di un minuto).
 * Servono contro i tentativi a raffica sulla rete interna: otto errori al minuto sullo stesso
 * utente sono un attacco o una tastiera rotta, in entrambi i casi meglio fermarsi un attimo.
 */
/**
 * Lunghezza minima delle password degli operatori (creazione dal pannello e cambio da parte
 * dell'operatore). Otto caratteri, senza regole di composizione: la difesa vera è il limite ai
 * tentativi, e una regola complicata finisce scritta su un foglietto accanto alla postazione.
 */
export const MIN_PASSWORD_LENGTH = 8;

export const LOGIN_RATE_LIMIT = {
  perIp: { limit: 30, windowMs: 60_000 },
  perUser: { limit: 8, windowMs: 60_000 },
} as const;

/**
 * Connessioni SSE aperte contemporaneamente. Un flusso tiene una connessione finché il client non
 * chiude: sul server dell'officina il tetto evita che un solo indirizzo le esaurisca. Chi supera
 * il limite riceve 503 e il client torna al polling.
 */
export const SSE_CONNECTION_LIMITS = {
  public: { perClient: 6, total: 200 },
  operator: { perClient: 12, total: 300 },
} as const;

/**
 * Nuovi tentativi automatici della sincronizzazione dopo un fallimento (minuti dall'ultimo esito).
 * Quattro tentativi in circa tre quarti d'ora coprono un DMS che riparte; oltre, resta il pulsante
 * "Riprova" della dashboard, che è la via manuale prevista.
 */
export const SYNC_RETRY_BACKOFF_MINUTES = [2, 5, 10, 30] as const;

/**
 * Resilienza della porta Infinity: timeout per chiamata, ripetizioni sugli errori di rete e
 * interruttore di circuito (dopo tre guasti consecutivi Infinity non viene chiamato per un
 * minuto, poi una sola chiamata di prova).
 */
export const INFINITY_RESILIENCE = {
  timeoutMs: 8_000,
  retries: 2,
  retryBaseDelayMs: 500,
  failureThreshold: 3,
  openForMs: 60_000,
} as const;

/** "Il turno si avvicina": quante pratiche del proprio sportello possono restare davanti. */
export const TURN_APPROACHING_AHEAD = 2;

/**
 * Giorni di conservazione dei file delle foto (env PHOTO_RETENTION_DAYS). Un mese copre il tempo
 * in cui un cliente può contestare un danno al ritiro; oltre, i file occupano solo il disco
 * dell'officina. I record restano per sempre: dicono che il giro era stato fatto.
 */
export const DEFAULT_PHOTO_RETENTION_DAYS = 30;

/**
 * Giorni dopo l'archiviazione oltre i quali anche il RECORD della foto viene eliminato (env
 * PHOTO_HARD_DELETE_DAYS). Un trimestre dopo la sparizione del file nessuno cerca più la scheda:
 * tenerla ancora sarebbe solo accumulo. In totale, quindi, una foto lascia traccia per
 * PHOTO_RETENTION_DAYS + PHOTO_HARD_DELETE_DAYS giorni (default 120).
 */
export const DEFAULT_PHOTO_HARD_DELETE_DAYS = 90;
