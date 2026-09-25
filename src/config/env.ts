// Lettura e parsing tipizzato delle variabili d'ambiente, con default sicuri (tutto mock).
// L'ambiente è letto da `process.env` (tipizzato da @types/node), con fallback su un oggetto vuoto
// dove `process` non esiste (browser, test isolati). In M0-T10 il parser manuale sarà sostituito
// da uno schema Zod che esporta gli stessi tipi.
// Non importa nulla dai factory né dai mock: i tipi condivisi vivono in services/interfaces.

import { parsePhoneE164 } from '@/domain/value-objects/phone';
import type {
  CrmMockMode,
  InfinityMockMode,
  ProviderMockMode,
} from '@/services/interfaces/mock-config';
import { databaseUrlFromEnv } from './database-url';
import { MOCK_PHONE_RULES } from '@/services/interfaces/mock-config';
import type {
  MediaStorageProvider,
  ProviderKind,
  RepositoryProvider,
  SpokiMode,
} from '@/services/interfaces/provider-kinds';
import {
  DEFAULT_BUSINESS_DAY_END,
  DEFAULT_CODE_PREFIX,
  DEFAULT_MEDIA_HARD_DELETE_DAYS,
  DEFAULT_MEDIA_RETENTION_DAYS,
  DEFAULT_MEDIA_DIR,
  DEFAULT_REMINDER_PREVIOUS_DAY_HOUR,
  DEFAULT_REMINDER_SAME_DAY_HOUR,
  DEFAULT_SYNC_HOUR_LOCAL,
  TIMEZONE,
  DEFAULT_MAX_EARLY_ARRIVAL_MINUTES,
} from './constants';

/** Sorgente grezza delle variabili (process.env o un oggetto nei test). */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Profilo dei dati di riferimento (SEED_PROFILE): `demo` (officina di prova, password "demo") o
 * `real` (officina di Bari, solo l'amministratore con hash scrypt; vedi config/seed.ts).
 */
export type SeedProfile = 'demo' | 'real';

/**
 * Visibilità del pulsante «Nuovo cliente (senza appuntamento)» (UI_MANUAL_INTAKE): l'inserimento
 * avviene a monte in Infinity dal BDC, quindi di norma lo vedono solo responsabili e amministratori
 * come fallback; `all` lo mostra a tutti, `none` a nessuno. L'API resta in ogni caso.
 */
export type ManualIntakeUi = 'none' | 'managers' | 'all';

/** Legge `process.env` se esiste (Node, edge), altrimenti un oggetto vuoto (browser, test isolati). */
export function readEnvSource(): EnvSource {
  return typeof process !== 'undefined' && process.env !== undefined ? process.env : {};
}

/** Configurazione applicativa tipizzata. */
export interface AppEnv {
  readonly servicesProvider: ProviderKind;
  readonly infinityProvider: ProviderKind;
  readonly spokiProvider: ProviderKind;
  /**
   * SPOKI_ENABLED (predefinito false): interruttore dell'integrazione WhatsApp. Finché è false, o
   * manca SPOKI_API_KEY, la modalità effettiva è `simulation` qualunque sia SPOKI_MODE: i messaggi
   * vengono formattati e registrati, nessun credito WhatsApp viene consumato.
   */
  readonly spokiEnabled: boolean;
  /**
   * Con SPOKI_PROVIDER=real: simulazione (nessuna chiamata) o live. È la modalità EFFETTIVA:
   * `live` solo se richiesta E l'integrazione è accesa con la chiave API presente.
   */
  readonly spokiMode: SpokiMode;
  /**
   * Blocco di sicurezza (SPOKI_SAFETY_LOCK, predefinito true): finché è attivo nessun WhatsApp
   * parte verso un telefono reale, qualunque sia la modalità. Va tolto esplicitamente.
   */
  readonly spokiSafetyLock: boolean;
  /**
   * SPOKI_ALLOWED_RECIPIENTS: numeri interni (E.164, separati da virgola) a cui un WhatsApp reale può
   * arrivare durante la demo. Finché SPOKI_PUBLIC_SENDS non è true, anche con Spoki in live e il
   * blocco tolto, verso tutti gli altri numeri l'invio resta simulato e registrato.
   */
  readonly spokiAllowedRecipients: readonly string[];
  /**
   * SPOKI_PUBLIC_SENDS (predefinito false): true apre gli invii reali a tutti i clienti. Si accende
   * solo quando il committente decide di uscire dalla demo interna.
   */
  readonly spokiPublicSends: boolean;
  /**
   * SPOKI_OVERRIDE_CONSENT (predefinito false): i promemoria sono comunicazioni di servizio
   * sull'appuntamento già preso, quindi con true si tenta WhatsApp anche senza il consenso esplicito
   * in anagrafica (Infinity non porta un opt-in WhatsApp). Non tocca il guardrail degli invii reali.
   */
  readonly spokiOverrideConsent: boolean;
  /** Chiave API dell'account Spoki (menu "Integrazioni API", intestazione X-Spoki-Api-Key); null se non impostata. */
  readonly spokiApiKey: string | null;
  /** Base delle API Spoki (SPOKI_API_BASE_URL, predefinito https://api.spoki.com), senza barra finale. */
  readonly spokiApiBaseUrl: string;
  /**
   * Id dei template Meta approvati per i due messaggi del check-in, inviati via API
   * (SPOKI_TEMPLATE_WELCOME_ID: presa in carico con link al portale; SPOKI_TEMPLATE_COMPLETE_ID:
   * accettazione completata). null = non configurato: in live il messaggio ripiega sull'SMS.
   */
  readonly spokiTemplateWelcomeId: string | null;
  readonly spokiTemplateCompleteId: string | null;
  /**
   * Id dei template Meta dei promemoria e delle tre risposte automatiche ai pulsanti del
   * promemoria del giorno stesso («Sono arrivato», «In ritardo», «Non posso venire»). Se un
   * promemoria ha l'id, parte via API al posto dell'automazione (SPOKI_URL_*).
   */
  readonly spokiTemplateReminderD1Id: string | null;
  readonly spokiTemplateSameDayId: string | null;
  readonly spokiTemplateArrivedReplyId: string | null;
  readonly spokiTemplateLateReplyId: string | null;
  readonly spokiTemplateAbsentReplyId: string | null;
  /** Id del template della risposta a chi tocca «Sono arrivato» troppo presto. */
  readonly spokiTemplateEarlyReplyId: string | null;
  /**
   * Finestra di anticipo massimo per «Sono arrivato» da WhatsApp (SPOKI_MAX_EARLY_ARRIVAL_MINUTES,
   * predefinito 60): oltre, la pratica non entra in fila e il cliente riceve un messaggio che spiega
   * quando ripremere. 0 = solo dall'orario in avanti.
   */
  readonly spokiMaxEarlyArrivalMinutes: number;
  /**
   * Segreto dei webhook V2 di Spoki (SPOKI_WEBHOOK_SECRET, `whsec_…`): verifica la firma
   * `X-Spoki-Signature` degli esiti di consegna (inviato, consegnato, letto, fallito) e dei
   * messaggi in entrata su POST /api/v1/webhooks/spoki. Vale anche come segreto condiviso
   * (`x-spoki-secret`). Senza, gli esiti non vengono accettati (404).
   */
  readonly spokiWebhookSecret: string | null;
  /**
   * SPOKI_LUOGO: la sede scritta nel campo LUOGO dei template 📅 (Reminder 24h, Conferma
   * Prenotazione). null finché il committente non la indica: quei template non partono con un campo
   * vuoto e ripiegano sull'SMS.
   */
  readonly spokiSite: string | null;
  /** Id del template 📅 Conferma Prenotazione (SPOKI_TEMPLATE_BOOKING_ID). */
  readonly spokiTemplateBookingId: string | null;
  /**
   * Tutti i segreti dei webhook V2 (SPOKI_WEBHOOK_SECRET, separati da virgola): Spoki genera un
   * `whsec_…` per ogni webhook e ogni webhook ha un solo evento (`message.inbound`,
   * `message.outbound`), quindi i segreti sono di norma due. Il primo è `spokiWebhookSecret`.
   */
  readonly spokiWebhookSecrets: readonly string[];
  /**
   * SPOKI_REPLIES_BY_AUTOMATION (predefinito false): true quando le automazioni Spoki dei tre pulsanti
   * sono attive. Rispondono loro al cliente, anche a server giù; l'app registra il fatto e restituisce
   * all'automazione il testo della conferma, ma non la manda di suo.
   */
  readonly spokiRepliesByAutomation: boolean;
  /** URL e segreti delle automazioni dei due promemoria (giorno prima, giorno stesso). */
  readonly spokiUrlReminderPreviousDay: string | null;
  readonly spokiUrlReminderSameDay: string | null;
  readonly spokiSecretReminderPreviousDay: string | null;
  readonly spokiSecretReminderSameDay: string | null;
  /**
   * Segreto delle risposte in entrata (SPOKI_INBOUND_SECRET): Spoki lo rimanda nel corpo o
   * nell'intestazione `x-spoki-secret` quando il cliente tocca «Arrivato», «In ritardo» o
   * «Assente». Senza segreto configurato il webhook risponde 404: meglio spento che aperto.
   */
  readonly spokiInboundSecret: string | null;
  /** URL delle automazioni degli altri template (non integrati in questa fase); null se non impostati. */
  readonly spokiUrlConfirmation: string | null;
  readonly spokiUrlTurnApproaching: string | null;
  readonly spokiUrlCancellation: string | null;
  /** Promemoria programmati (REMINDERS_ENABLED) e loro ore locali "HH:mm". */
  readonly remindersEnabled: boolean;
  readonly reminderPreviousDayHourLocal: string;
  readonly reminderSameDayHourLocal: string;
  /**
   * SPOKI_SAFETY_NET_TIME, ora locale "HH:mm" della rete di sicurezza in Spoki (automazione a data
   * sul campo ACC_GIORNO che manda il promemoria del giorno a chi ha ancora ACC_PROMEMORIA =
   * DA_INVIARE). Da quell'ora l'app non manda più il promemoria del giorno. null = rete spenta
   * (predefinito); deve essere dopo REMINDER_SAME_DAY_HOUR_LOCAL, altrimenti si spegne con un avviso.
   */
  readonly spokiSafetyNetTime: string | null;
  /** Indirizzo pubblico del portale cliente, usato nei link dei messaggi. */
  readonly publicBaseUrl: string;
  readonly smsProvider: ProviderKind;
  readonly crmProvider: ProviderKind;
  readonly repositoryProvider: RepositoryProvider;
  readonly mediaStorageProvider: MediaStorageProvider;
  /** Cartella dei file quando lo storage media è `local`. */
  readonly mediaStorageDir: string;
  /** URL SQLite del database (`file:./.data/accettazione.db` se manca): vale con REPOSITORY_PROVIDER=prisma. */
  readonly databaseUrl: string;
  /** Rinvii automatici al CRM dal processo dell'app (false quando li fa un cron esterno). */
  readonly crmRetryEnabled: boolean;
  /** Se true i monitor devono passare il token della propria accettazione (?token=). */
  readonly displayTokenRequired: boolean;
  /**
   * Fiducia in `X-Forwarded-For`/`X-Real-IP` (TRUST_PROXY_HEADERS): solo dietro un reverse proxy
   * che li sovrascrive. Senza, l'indirizzo lo dichiara il client e i contatori per indirizzo non
   * si applicano (restano quelli globali e per soggetto).
   */
  readonly trustProxyHeaders: boolean;
  /**
   * Le scritture del portale cliente («Sono qui», «In ritardo») richiedono il token personale del
   * link (PORTAL_WRITES_REQUIRE_TOKEN): dal QR con la sola targa si può soltanto consultare.
   * Predefinito false finché i link WhatsApp non sono in uso.
   */
  readonly portalWritesRequireToken: boolean;
  /** Messaggi al cliente guidati dagli eventi (conferma, turno vicino, annullamento). */
  readonly messagingTriggersEnabled: boolean;
  /**
   * NOTIFICATION_RETRY_ENABLED (predefinito true): riprova automatica dei messaggi falliti per un
   * problema temporaneo, con attesa crescente. Spento, restano fermi finché qualcuno non preme
   * «Riprova» nella schermata Comunicazioni.
   */
  readonly notificationRetryEnabled: boolean;
  /**
   * `MESSAGING_STANDBY` (predefinito false): mette in pausa TUTTA l'integrazione con il cliente —
   * promemoria programmati, messaggi guidati dagli eventi e webhook delle risposte. Serve mentre
   * si lavora al resto dell'applicazione: senza credenziali Spoki l'officina funziona lo stesso,
   * e nei log non compaiono errori di invii che nessuno voleva fare.
   */
  readonly messagingStandby: boolean;
  /**
   * Giorni di conservazione dei file di foto e video dell'ispezione (`MEDIA_RETENTION_DAYS`, o il
   * vecchio nome `PHOTO_RETENTION_DAYS` per chi ha già un .env). La pulizia è automatica: nessun
   * operatore deve ricordarsi di cancellare niente.
   */
  readonly photoRetentionDays: number;
  /** Giorni dopo l'archiviazione oltre i quali il record del media viene eliminato. */
  readonly photoHardDeleteDays: number;
  /** Segreto per il cron esterno dei rinvii CRM (null = solo sessione amministratore). */
  readonly cronSecret: string | null;
  /**
   * Fuso dell'officina (`APP_TIMEZONE`, zona IANA validata). Volutamente NON letto da `TZ`:
   * nei container Docker `TZ` è spesso UTC e farebbe scivolare giornata operativa e sync.
   */
  readonly timeZone: string;
  /** Ora locale "HH:mm" della sync giornaliera. */
  readonly syncHourLocal: string;
  /** Ora locale di fine turno: dopo, la giornata si chiude da sola. */
  readonly businessDayEndLocal: string;
  readonly codePrefix: string;
  readonly codeSequenceScope: 'SITE' | 'BRAND';
  readonly mockSeed: string;
  /** Profilo dei dati di riferimento (SEED_PROFILE): demo o real. */
  readonly seedProfile: SeedProfile;
  /** Pulsante dell'inserimento manuale nella dashboard (UI_MANUAL_INTAKE, default managers). */
  readonly uiManualIntake: ManualIntakeUi;
  /**
   * Accesso veloce di sviluppo nella pagina di login (DEV_QUICK_LOGIN): pulsanti per entrare come
   * amministratore, responsabile o accettatore senza credenziali. Acceso di default fuori dalla
   * produzione, sempre spento con NODE_ENV=production.
   */
  readonly devQuickLogin: boolean;
  /** Hash scrypt della password iniziale dell'amministratore (SEED_ADMIN_PASSWORD_HASH), profilo real. */
  readonly seedAdminPasswordHash: string | null;
  /** Segreto da cui derivano i token dei display (SEED_DISPLAY_TOKEN_SECRET), profilo real. */
  readonly seedDisplayTokenSecret: string | null;
  readonly mockLatencyMs: number;
  readonly mockInfinityMode: InfinityMockMode;
  readonly mockInfinityFlakyFailures: number;
  /** Se true, ~5 % dell'agenda risulta annullata dalla seconda chiamata dello stesso giorno (reconciliation). */
  readonly mockInfinityCancelOnSecondCall: boolean;
  readonly mockSpokiFailSuffix: string;
  readonly mockSpokiFailureRate: number | null;
  readonly mockSpokiMode: ProviderMockMode;
  readonly mockSmsFailSuffix: string;
  readonly mockSmsFailureRate: number | null;
  readonly mockSmsMode: ProviderMockMode;
  readonly mockSmsCredits: number;
  readonly mockCrmMode: CrmMockMode;
  readonly mockDeliveryDelayMs: number;
  /** Latenza simulata del salvataggio delle foto (tablet): fa vedere il caricamento in corso. */
  readonly mockMediaLatencyMs: number;
  readonly nodeEnv: 'development' | 'test' | 'production';
}

/** Callback per i valori non validi (default: console.warn). */
export type EnvWarning = (message: string) => void;

const PROVIDER_KINDS: readonly ProviderKind[] = ['mock', 'real'];
const REPOSITORY_PROVIDERS: readonly RepositoryProvider[] = ['memory', 'prisma'];
const MEDIA_PROVIDERS: readonly MediaStorageProvider[] = ['memory', 'local', 'blob'];
const INFINITY_MODES: readonly InfinityMockMode[] = [
  'ok',
  'error',
  'timeout',
  'flaky',
  'partial',
  'empty',
];
const UP_DOWN: readonly ProviderMockMode[] = ['ok', 'down'];
const CRM_MODES: readonly CrmMockMode[] = ['ok', 'error', 'timeout', 'flaky'];
const SEQUENCE_SCOPES: readonly AppEnv['codeSequenceScope'][] = ['SITE', 'BRAND'];
const NODE_ENVS: readonly AppEnv['nodeEnv'][] = ['development', 'test', 'production'];
const SPOKI_MODES: readonly SpokiMode[] = ['simulation', 'live'];
const DEFAULT_SPOKI_API_BASE_URL = 'https://api.spoki.com';
/** Sotto questa lunghezza un segreto di webhook non è un segreto: si ignora, con avviso. */
const MIN_WEBHOOK_SECRET_LENGTH = 16;

/**
 * Modalità Spoki EFFETTIVA. `live` richiede tre cose insieme: SPOKI_MODE=live, SPOKI_ENABLED=true
 * e SPOKI_API_KEY presente. Manca una delle tre → `simulation`, e se il live era stato chiesto lo
 * si dice nel log: un invio che non parte deve avere un perché leggibile.
 */
function pickSpokiMode(
  source: EnvSource,
  enabled: boolean,
  apiKey: string | null,
  warn: EnvWarning,
): SpokiMode {
  const richiesta = pickEnum(source, 'SPOKI_MODE', SPOKI_MODES, 'simulation', warn);
  if (richiesta !== 'live') {
    return 'simulation';
  }
  if (!enabled) {
    warn('SPOKI_MODE=live ignorato: SPOKI_ENABLED=false. Modalità effettiva: simulation.');
    return 'simulation';
  }
  if (apiKey === null) {
    warn('SPOKI_MODE=live ignorato: SPOKI_API_KEY assente. Modalità effettiva: simulation.');
    return 'simulation';
  }
  return 'live';
}

/** SPOKI_WEBHOOK_SECRET: accettato solo se abbastanza lungo da essere un segreto. */
/**
 * SPOKI_WEBHOOK_SECRET: uno o più segreti separati da virgola (uno per webhook V2). Quelli troppo
 * corti si scartano con un avviso: un segreto indovinabile aprirebbe l'agenda a chiunque.
 */
function pickWebhookSecrets(source: EnvSource, warn: EnvWarning): readonly string[] {
  const valore = pickStringOrNull(source, 'SPOKI_WEBHOOK_SECRET');
  if (valore === null) {
    return [];
  }
  const segreti: string[] = [];
  for (const parte of valore
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)) {
    if (parte.length < MIN_WEBHOOK_SECRET_LENGTH) {
      warn(
        `SPOKI_WEBHOOK_SECRET: un segreto è troppo corto (${parte.length} caratteri, minimo ${MIN_WEBHOOK_SECRET_LENGTH}): ignorato.`,
      );
      continue;
    }
    segreti.push(parte);
  }
  return [...new Set(segreti)];
}
const SEED_PROFILES: readonly SeedProfile[] = ['demo', 'real'];
const MANUAL_INTAKE_UI: readonly ManualIntakeUi[] = ['none', 'managers', 'all'];

/** True se almeno un provider punta a dati veri (database Prisma, Infinity o servizi reali). */
function hasRealData(source: EnvSource): boolean {
  return ['REPOSITORY_PROVIDER', 'INFINITY_PROVIDER', 'SERVICES_PROVIDER'].some((k) =>
    ['prisma', 'real'].includes(source[k]?.trim().toLowerCase() ?? ''),
  );
}

/**
 * DEV_QUICK_LOGIN: mai in produzione, qualunque cosa dica la variabile. Acceso per default solo
 * quando tutto è mock: con dati veri (Prisma, Infinity) va chiesto esplicitamente, e viene detto
 * a chiare lettere, perché chiunque raggiunga il server entra da amministratore senza credenziali.
 */
function pickDevQuickLogin(source: EnvSource, warn: EnvWarning): boolean {
  const production = source['NODE_ENV']?.trim() === 'production';
  const datiReali = hasRealData(source);
  const richiesto = pickBool(source, 'DEV_QUICK_LOGIN', !production && !datiReali, warn);
  if (production && richiesto) {
    warn("DEV_QUICK_LOGIN=true ignorato con NODE_ENV=production: l'accesso veloce resta spento.");
    return false;
  }
  if (richiesto && datiReali) {
    warn(
      'DEV_QUICK_LOGIN=true con dati reali (Prisma/Infinity): chiunque raggiunga il server entra senza credenziali. Spegnerlo appena finiti i test sul dispositivo.',
    );
  }
  return richiesto;
}

/**
 * CRON_SECRET: assente → solo la sessione amministratore apre gli endpoint cron. Un segreto corto
 * si indovina: sotto i 32 caratteri viene ignorato (con avviso), non accettato a metà.
 */
function pickCronSecret(source: EnvSource, warn: EnvWarning): string | null {
  const raw = pickString(source, 'CRON_SECRET', '').trim();
  if (raw === '') {
    return null;
  }
  if (raw.length < 32) {
    warn(
      `CRON_SECRET troppo corto (${raw.length} caratteri): minimo 32. Ignorato, gli endpoint cron accettano solo la sessione amministratore.`,
    );
    return null;
  }
  return raw;
}

function defaultWarning(message: string): void {
  console.warn(`[env] ${message}`);
}

function pickEnum<T extends string>(
  source: EnvSource,
  key: string,
  allowed: readonly T[],
  fallback: T,
  warn: EnvWarning,
): T {
  const raw = source[key];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const found = allowed.find((v) => v === raw.trim());
  if (found === undefined) {
    warn(`${key}="${raw}" non valido; ammessi: ${allowed.join(', ')}. Uso "${fallback}".`);
    return fallback;
  }
  return found;
}

/**
 * Elenco di numeri in E.164 (separati da virgola, spazi e trattini ammessi): quelli non validi si
 * scartano con un avviso, così un refuso non apre gli invii a un numero sbagliato.
 */
function pickPhoneList(source: EnvSource, key: string, warn: EnvWarning): readonly string[] {
  const raw = source[key];
  if (raw === undefined || raw.trim() === '') {
    return [];
  }
  const numeri: string[] = [];
  for (const parte of raw
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)) {
    const numero = parsePhoneE164(parte);
    if (numero.ok) {
      numeri.push(numero.value);
    } else {
      warn(`${key}: numero non valido ignorato (${parte.slice(0, 4)}…).`);
    }
  }
  return [...new Set(numeri)];
}

function pickStringOrNull(source: EnvSource, key: string): string | null {
  const raw = source[key];
  return raw === undefined || raw.trim() === '' ? null : raw.trim();
}

function pickString(source: EnvSource, key: string, fallback: string): string {
  const raw = source[key];
  return raw === undefined || raw.trim() === '' ? fallback : raw.trim();
}

function pickBool(source: EnvSource, key: string, fallback: boolean, warn: EnvWarning): boolean {
  const raw = source[key];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') {
    return true;
  }
  if (v === 'false' || v === '0' || v === 'no') {
    return false;
  }
  warn(`${key}="${raw}" non è un booleano (true/false). Uso ${String(fallback)}.`);
  return fallback;
}

function pickInt(
  source: EnvSource,
  key: string,
  fallback: number,
  warn: EnvWarning,
  min = 0,
): number {
  const raw = source[key];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min) {
    warn(`${key}="${raw}" non è un intero ≥ ${min}. Uso ${fallback}.`);
    return fallback;
  }
  return n;
}

function pickRateOrNull(source: EnvSource, key: string, warn: EnvWarning): number | null {
  const raw = source[key];
  if (raw === undefined || raw.trim() === '') {
    return null;
  }
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    warn(`${key}="${raw}" non è un numero fra 0 e 1. Regola delle cifre attiva.`);
    return null;
  }
  return n;
}

function pickHourLocal(source: EnvSource, key: string, fallback: string, warn: EnvWarning): string {
  const raw = pickString(source, key, fallback);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) {
    warn(`${key}="${raw}" non è un orario HH:mm. Uso "${fallback}".`);
    return fallback;
  }
  return raw;
}

/** Ora "HH:mm" facoltativa: vuota = null; non valida = null con avviso. */
function pickHourLocalOrNull(source: EnvSource, key: string, warn: EnvWarning): string | null {
  const raw = pickStringOrNull(source, key);
  if (raw === null) {
    return null;
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) {
    warn(`${key}="${raw}" non è un orario HH:mm: ignorato.`);
    return null;
  }
  return raw;
}

/**
 * La rete di sicurezza deve scattare DOPO il promemoria del giorno: prima, l'app lascerebbe sempre
 * il promemoria a Spoki senza averci provato.
 */
function pickSafetyNetTime(
  source: EnvSource,
  sameDayHour: string,
  warn: EnvWarning,
): string | null {
  const ora = pickHourLocalOrNull(source, 'SPOKI_SAFETY_NET_TIME', warn);
  if (ora !== null && ora <= sameDayHour) {
    warn(
      `SPOKI_SAFETY_NET_TIME=${ora} non è dopo il promemoria del giorno (${sameDayHour}): rete di sicurezza spenta.`,
    );
    return null;
  }
  return ora;
}

/**
 * Legge una zona IANA e la valida con `Intl.DateTimeFormat`: un valore errato farebbe
 * lanciare RangeError alla prima `toBusinessDate` (crash all'avvio), quindi si ricade sul default.
 */
function pickTimeZone(source: EnvSource, key: string, fallback: string, warn: EnvWarning): string {
  const raw = pickString(source, key, fallback);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: raw });
    return raw;
  } catch {
    warn(`${key}="${raw}" non è una zona IANA valida. Uso "${fallback}".`);
    return fallback;
  }
}

/**
 * Parsing dell'ambiente con default sicuri: tutto mock/memory, fuso Europe/Rome,
 * sync alle 06:00, prefisso codice "F". I valori non validi producono un warning
 * e ricadono sul default: la configurazione non deve mai impedire l'avvio.
 *
 * Variabili lette: SERVICES_PROVIDER, INFINITY_PROVIDER, SPOKI_PROVIDER, SMS_PROVIDER,
 * CRM_PROVIDER, REPOSITORY_PROVIDER, MEDIA_STORAGE_PROVIDER, APP_TIMEZONE, SYNC_HOUR_LOCAL,
 * CODE_PREFIX, CODE_SEQUENCE_SCOPE, SEED_PROFILE, SEED_ADMIN_PASSWORD_HASH, SEED_DISPLAY_TOKEN_SECRET,
 * MOCK_SEED, MOCK_LATENCY_MS,
 * MOCK_INFINITY_MODE, MOCK_INFINITY_FLAKY_FAILURES, MOCK_INFINITY_CANCEL_ON_SECOND_CALL,
 * MOCK_SPOKI_FAIL_SUFFIX, MOCK_SPOKI_FAILURE_RATE, MOCK_SPOKI_MODE, MOCK_SMS_FAIL_SUFFIX,
 * MOCK_SMS_FAILURE_RATE, MOCK_SMS_MODE, MOCK_SMS_CREDITS, MOCK_CRM_MODE, MOCK_DELIVERY_DELAY_MS, NODE_ENV,
 * SPOKI_ENABLED, SPOKI_MODE, SPOKI_SAFETY_LOCK, SPOKI_API_KEY, SPOKI_API_BASE_URL,
 * SPOKI_TEMPLATE_WELCOME_ID, SPOKI_TEMPLATE_COMPLETE_ID, SPOKI_TEMPLATE_REMINDER_D1_ID,
 * SPOKI_TEMPLATE_SAME_DAY_ID, SPOKI_TEMPLATE_ARRIVED_REPLY_ID, SPOKI_TEMPLATE_LATE_REPLY_ID,
 * SPOKI_TEMPLATE_ABSENT_REPLY_ID, SPOKI_TEMPLATE_EARLY_REPLY_ID, SPOKI_MAX_EARLY_ARRIVAL_MINUTES,
 * SPOKI_WEBHOOK_SECRET, SPOKI_INBOUND_SECRET.
 */
export function parseEnv(
  source: EnvSource = readEnvSource(),
  warn: EnvWarning = defaultWarning,
): AppEnv {
  const servicesProvider = pickEnum(source, 'SERVICES_PROVIDER', PROVIDER_KINDS, 'mock', warn);
  const perPort = (key: string): ProviderKind =>
    pickEnum(source, key, PROVIDER_KINDS, servicesProvider, warn);
  const spokiEnabled = pickBool(source, 'SPOKI_ENABLED', false, warn);
  const spokiApiKey = pickStringOrNull(source, 'SPOKI_API_KEY');

  const webhookSecrets = pickWebhookSecrets(source, warn);
  const sameDayHour = pickHourLocal(
    source,
    'REMINDER_SAME_DAY_HOUR_LOCAL',
    DEFAULT_REMINDER_SAME_DAY_HOUR,
    warn,
  );
  return {
    servicesProvider,
    infinityProvider: perPort('INFINITY_PROVIDER'),
    spokiProvider: perPort('SPOKI_PROVIDER'),
    spokiEnabled,
    spokiMode: pickSpokiMode(source, spokiEnabled, spokiApiKey, warn),
    // Predefinito TRUE: il blocco si toglie solo per scelta esplicita, mai per dimenticanza.
    spokiSafetyLock: pickBool(source, 'SPOKI_SAFETY_LOCK', true, warn),
    spokiAllowedRecipients: pickPhoneList(source, 'SPOKI_ALLOWED_RECIPIENTS', warn),
    // Predefinito FALSE: la demo è interna finché il committente non dice altrimenti.
    spokiPublicSends: pickBool(source, 'SPOKI_PUBLIC_SENDS', false, warn),
    spokiOverrideConsent: pickBool(source, 'SPOKI_OVERRIDE_CONSENT', false, warn),
    spokiApiKey,
    spokiApiBaseUrl: pickString(source, 'SPOKI_API_BASE_URL', DEFAULT_SPOKI_API_BASE_URL).replace(
      /\/+$/,
      '',
    ),
    spokiTemplateWelcomeId: pickStringOrNull(source, 'SPOKI_TEMPLATE_WELCOME_ID'),
    spokiTemplateCompleteId: pickStringOrNull(source, 'SPOKI_TEMPLATE_COMPLETE_ID'),
    spokiTemplateReminderD1Id: pickStringOrNull(source, 'SPOKI_TEMPLATE_REMINDER_D1_ID'),
    spokiTemplateSameDayId: pickStringOrNull(source, 'SPOKI_TEMPLATE_SAME_DAY_ID'),
    spokiTemplateArrivedReplyId: pickStringOrNull(source, 'SPOKI_TEMPLATE_ARRIVED_REPLY_ID'),
    spokiTemplateLateReplyId: pickStringOrNull(source, 'SPOKI_TEMPLATE_LATE_REPLY_ID'),
    spokiTemplateAbsentReplyId: pickStringOrNull(source, 'SPOKI_TEMPLATE_ABSENT_REPLY_ID'),
    spokiTemplateEarlyReplyId: pickStringOrNull(source, 'SPOKI_TEMPLATE_EARLY_REPLY_ID'),
    spokiTemplateBookingId: pickStringOrNull(source, 'SPOKI_TEMPLATE_BOOKING_ID'),
    spokiSite: pickStringOrNull(source, 'SPOKI_LUOGO'),
    spokiMaxEarlyArrivalMinutes: pickInt(
      source,
      'SPOKI_MAX_EARLY_ARRIVAL_MINUTES',
      DEFAULT_MAX_EARLY_ARRIVAL_MINUTES,
      warn,
    ),
    spokiWebhookSecret: webhookSecrets[0] ?? null,
    spokiWebhookSecrets: webhookSecrets,
    spokiRepliesByAutomation: pickBool(source, 'SPOKI_REPLIES_BY_AUTOMATION', false, warn),
    spokiUrlReminderPreviousDay: pickStringOrNull(source, 'SPOKI_URL_REMINDER_PREVIOUS_DAY'),
    spokiUrlReminderSameDay: pickStringOrNull(source, 'SPOKI_URL_REMINDER_SAME_DAY'),
    spokiSecretReminderPreviousDay: pickStringOrNull(source, 'SPOKI_SECRET_REMINDER_PREVIOUS_DAY'),
    spokiSecretReminderSameDay: pickStringOrNull(source, 'SPOKI_SECRET_REMINDER_SAME_DAY'),
    spokiInboundSecret: pickStringOrNull(source, 'SPOKI_INBOUND_SECRET'),
    remindersEnabled: pickBool(source, 'REMINDERS_ENABLED', true, warn),
    reminderPreviousDayHourLocal: pickHourLocal(
      source,
      'REMINDER_PREVIOUS_DAY_HOUR_LOCAL',
      DEFAULT_REMINDER_PREVIOUS_DAY_HOUR,
      warn,
    ),
    reminderSameDayHourLocal: sameDayHour,
    spokiSafetyNetTime: pickSafetyNetTime(source, sameDayHour, warn),
    spokiUrlConfirmation: pickStringOrNull(source, 'SPOKI_URL_CONFIRMATION'),
    spokiUrlTurnApproaching: pickStringOrNull(source, 'SPOKI_URL_TURN_APPROACHING'),
    spokiUrlCancellation: pickStringOrNull(source, 'SPOKI_URL_CANCELLATION'),
    publicBaseUrl: pickString(source, 'PUBLIC_BASE_URL', 'http://localhost:3000').replace(
      /\/+$/,
      '',
    ),
    smsProvider: perPort('SMS_PROVIDER'),
    crmProvider: perPort('CRM_PROVIDER'),
    repositoryProvider: pickEnum(
      source,
      'REPOSITORY_PROVIDER',
      REPOSITORY_PROVIDERS,
      'memory',
      warn,
    ),
    mediaStorageProvider: pickEnum(
      source,
      'MEDIA_STORAGE_PROVIDER',
      MEDIA_PROVIDERS,
      'local',
      warn,
    ),
    mediaStorageDir: pickString(source, 'MEDIA_STORAGE_DIR', DEFAULT_MEDIA_DIR),
    databaseUrl: databaseUrlFromEnv(source),
    crmRetryEnabled: pickBool(source, 'CRM_RETRY_ENABLED', true, warn),
    displayTokenRequired: pickBool(source, 'DISPLAY_TOKEN_REQUIRED', false, warn),
    messagingTriggersEnabled: pickBool(source, 'MESSAGING_TRIGGERS_ENABLED', true, warn),
    notificationRetryEnabled: pickBool(source, 'NOTIFICATION_RETRY_ENABLED', true, warn),
    messagingStandby: pickBool(source, 'MESSAGING_STANDBY', false, warn),
    // Nome nuovo (MEDIA_*, perché ormai ci sono anche i video) con il vecchio come ripiego: un
    // .env già scritto continua a valere senza modifiche.
    photoRetentionDays: pickInt(
      source,
      'MEDIA_RETENTION_DAYS',
      pickInt(source, 'PHOTO_RETENTION_DAYS', DEFAULT_MEDIA_RETENTION_DAYS, warn),
      warn,
    ),
    photoHardDeleteDays: pickInt(
      source,
      'MEDIA_HARD_DELETE_DAYS',
      pickInt(source, 'PHOTO_HARD_DELETE_DAYS', DEFAULT_MEDIA_HARD_DELETE_DAYS, warn),
      warn,
    ),
    cronSecret: pickCronSecret(source, warn),
    trustProxyHeaders: pickBool(source, 'TRUST_PROXY_HEADERS', false, warn),
    portalWritesRequireToken: pickBool(source, 'PORTAL_WRITES_REQUIRE_TOKEN', false, warn),
    timeZone: pickTimeZone(source, 'APP_TIMEZONE', TIMEZONE, warn),
    syncHourLocal: pickHourLocal(source, 'SYNC_HOUR_LOCAL', DEFAULT_SYNC_HOUR_LOCAL, warn),
    businessDayEndLocal: pickHourLocal(
      source,
      'BUSINESS_DAY_END_TIME',
      DEFAULT_BUSINESS_DAY_END,
      warn,
    ),
    codePrefix: pickString(source, 'CODE_PREFIX', DEFAULT_CODE_PREFIX).toUpperCase(),
    codeSequenceScope: pickEnum(source, 'CODE_SEQUENCE_SCOPE', SEQUENCE_SCOPES, 'SITE', warn),
    mockSeed: pickString(source, 'MOCK_SEED', 'autoclub-demo'),
    seedProfile: pickEnum(source, 'SEED_PROFILE', SEED_PROFILES, 'demo', warn),
    // Predefinito none: le pratiche nascono in Infinity (BDC) e il pulsante in accettazione era
    // una porta laterale che nessuno deve usare. Dialogo e API restano, per riaccenderlo da env.
    uiManualIntake: pickEnum(source, 'UI_MANUAL_INTAKE', MANUAL_INTAKE_UI, 'none', warn),
    devQuickLogin: pickDevQuickLogin(source, warn),
    seedAdminPasswordHash: pickStringOrNull(source, 'SEED_ADMIN_PASSWORD_HASH'),
    seedDisplayTokenSecret: pickStringOrNull(source, 'SEED_DISPLAY_TOKEN_SECRET'),
    mockLatencyMs: pickInt(source, 'MOCK_LATENCY_MS', 150, warn),
    mockInfinityMode: pickEnum(source, 'MOCK_INFINITY_MODE', INFINITY_MODES, 'ok', warn),
    mockInfinityFlakyFailures: pickInt(source, 'MOCK_INFINITY_FLAKY_FAILURES', 2, warn),
    mockInfinityCancelOnSecondCall: pickBool(
      source,
      'MOCK_INFINITY_CANCEL_ON_SECOND_CALL',
      true,
      warn,
    ),
    mockSpokiFailSuffix: pickString(
      source,
      'MOCK_SPOKI_FAIL_SUFFIX',
      MOCK_PHONE_RULES.whatsappInvalid,
    ),
    mockSpokiFailureRate: pickRateOrNull(source, 'MOCK_SPOKI_FAILURE_RATE', warn),
    mockSpokiMode: pickEnum(source, 'MOCK_SPOKI_MODE', UP_DOWN, 'ok', warn),
    mockSmsFailSuffix: pickString(
      source,
      'MOCK_SMS_FAIL_SUFFIX',
      MOCK_PHONE_RULES.bothChannelsFail,
    ),
    mockSmsFailureRate: pickRateOrNull(source, 'MOCK_SMS_FAILURE_RATE', warn),
    mockSmsMode: pickEnum(source, 'MOCK_SMS_MODE', UP_DOWN, 'ok', warn),
    mockSmsCredits: pickInt(source, 'MOCK_SMS_CREDITS', 500, warn),
    mockCrmMode: pickEnum(source, 'MOCK_CRM_MODE', CRM_MODES, 'ok', warn),
    mockDeliveryDelayMs: pickInt(source, 'MOCK_DELIVERY_DELAY_MS', 3000, warn),
    mockMediaLatencyMs: pickInt(source, 'MOCK_MEDIA_LATENCY_MS', 1200, warn),
    nodeEnv: pickEnum(source, 'NODE_ENV', NODE_ENVS, 'development', warn),
  };
}
