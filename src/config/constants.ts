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

/**
 * Ora locale del promemoria del giorno prima (default di `REMINDER_PREVIOUS_DAY_HOUR_LOCAL`):
 * nel pomeriggio, quando l'agenda di domani è ormai stabile; prima si anticipa la sync di domani,
 * così il messaggio porta già il codice della pratica.
 */
export const DEFAULT_REMINDER_PREVIOUS_DAY_HOUR = '18:00';

/** Ora locale del promemoria del giorno stesso (default di `REMINDER_SAME_DAY_HOUR_LOCAL`): dopo la sync, all'apertura. */
export const DEFAULT_REMINDER_SAME_DAY_HOUR = '07:30';

/** Prefisso del codice progressivo F001 (default di `CODE_PREFIX`). */
export const DEFAULT_CODE_PREFIX = 'F';

/** Prefisso dei codici delle riconsegne (R001…): sequenza separata da quella della coda. */
export const RETURN_CODE_PREFIX = 'R';

/**
 * Cartella dei file caricati quando lo storage media è `local` (env MEDIA_STORAGE_DIR).
 * Sta sotto `.data/` come lo snapshot della giornata: è stato locale dell'officina, non codice,
 * e come tale resta fuori dal repository.
 */
export const DEFAULT_MEDIA_DIR = '.data/uploads';

/** Sportelli fisici dell'accettazione, A-D (usata da M1 per la scelta e da M4 per i monitor). */
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
  /** Rete di sicurezza a chiave costante: non si aggira ruotando indirizzi o intestazioni. */
  global: 3000,
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
 * Attese delle riprove automatiche di un messaggio fallito per un problema temporaneo (minuti):
 * dopo l'ultima, se non è ancora partito, diventa «da contattare a mano» nella schermata
 * Comunicazioni. Un messaggio sull'arrivo in officina non ha senso un'ora dopo: tre tentativi in
 * venti minuti, poi decide una persona.
 */
export const NOTIFICATION_RETRY_BACKOFF_MINUTES = [1, 5, 15] as const;

/** Riprove automatiche massime per un job (il primo invio non conta). */
export const NOTIFICATION_MAX_AUTO_RETRIES = NOTIFICATION_RETRY_BACKOFF_MINUTES.length;

/** Ogni quanto il temporizzatore guarda i messaggi da ritentare (ms). */
export const NOTIFICATION_DRAIN_INTERVAL_MS = 60_000;

/** Quanti messaggi ritenta al massimo per passata. */
export const NOTIFICATION_DRAIN_BATCH = 20;

/** Giorni indietro mostrati dalla schermata Comunicazioni. */
export const COMMUNICATIONS_LOOKBACK_DAYS = 7;

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
 * Giorni di conservazione dei FILE di foto e video dell'ispezione (env `MEDIA_RETENTION_DAYS`,
 * storicamente `PHOTO_RETENTION_DAYS`). Tre mesi: i tempi dell'officina sono questi, fra una
 * lavorazione lunga, un ricambio che tarda e un cliente che contesta un graffio settimane dopo il
 * ritiro. Oltre, i file occupano solo il disco. I record restano: dicono che il giro era stato
 * fatto, con data e parte del veicolo, anche quando l'immagine non c'è più.
 *
 * Attenzione al disco: con i video (fino a 80 MB l'uno) tre mesi pesano molto più di tre mesi di
 * sole foto. Se lo spazio stringe si abbassa il numero, senza toccare il codice.
 */
export const DEFAULT_MEDIA_RETENTION_DAYS = 90;

/**
 * Giorni dopo l'archiviazione oltre i quali anche il RECORD del media viene eliminato (env
 * `MEDIA_HARD_DELETE_DAYS`, storicamente `PHOTO_HARD_DELETE_DAYS`). Un trimestre dopo la
 * sparizione del file nessuno cerca più la scheda: tenerla ancora sarebbe solo accumulo. In
 * totale un media lascia traccia per MEDIA_RETENTION_DAYS + MEDIA_HARD_DELETE_DAYS giorni.
 */
export const DEFAULT_MEDIA_HARD_DELETE_DAYS = 90;

/** Nome della sede mostrato al cliente nel portale (accanto allo sportello). */
export const SITE_NAME = 'Autoclub Group';

/** Minuti di ritardo dichiarati dal pulsante rapido del portale ("Sto arrivando in ritardo"). */
export const CUSTOMER_LATE_NOTICE_MINUTES = 10;

/**
 * Quanti minuti prima dell'orario un cliente può dichiararsi arrivato da WhatsApp
 * (SPOKI_MAX_EARLY_ARRIVAL_MINUTES). Chi tocca «Sono arrivato» appena legge il promemoria del
 * mattino, con l'appuntamento alle 16:00, non entra in fila: riceve un messaggio che spiega
 * quando ripremere. Il pulsante «Sono qui» del portale non ha questa finestra: chi è sulla pagina è
 * già in officina.
 */
export const DEFAULT_MAX_EARLY_ARRIVAL_MINUTES = 60;

/** Dopo quanti minuti il cliente può rifare la segnalazione di ritardo (evita doppi tocchi). */
export const CUSTOMER_LATE_NOTICE_COOLDOWN_MINUTES = 5;

/** Ore dopo la chiusura della pratica oltre le quali il portale mostra solo "pratica conclusa". */
export const PORTAL_CONCLUDED_AFTER_HOURS = 24;

/**
 * Anti-abuso della segnalazione di ritardo dal portale: pochi tocchi per targa in dieci minuti
 * (il cliente ne fa uno), un tetto per indirizzo che regge il wifi ospiti dell'officina.
 */
export const PUBLIC_LATE_NOTICE_RATE_LIMIT = {
  perIp: 30,
  perPlate: 3,
  /** Rete di sicurezza a chiave costante sulle scritture del portale. */
  global: 600,
  windowMs: 600_000,
} as const;
