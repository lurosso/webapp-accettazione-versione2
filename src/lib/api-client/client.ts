// Client HTTP tipizzato verso /api/v1 (solo lato browser). Timeout di 8 s, errori come `ApiError`
// con il codice di dominio del server; su 401 riporta al login conservando il percorso corrente.
import type { Appointment } from '@/domain/entities/appointment';
import type { SyncRun } from '@/domain/entities/sync-run';
import type { Session } from '@/application/auth/IAuthService';
import type { BdcLeadsView, BdcLeadView, CrmOutboxView } from '@/domain/read-models';
import type { CrmOutboxEvent, CrmOutboxStatus } from '@/domain/entities/crm-outbox-event';
import type { DailyReportView } from '@/application/reporting/DailyReportService';
import type {
  CreateOperatorInput,
  OperatorView,
  ResetPasswordResult,
  UpdateOperatorInput,
} from '@/application/admin/OperatorAdminService';
import type { AssistanceView } from '@/application/admin/AssistanceService';
import type {
  SpokiOverview,
  SpokiTestKind,
  SpokiTestResult,
} from '@/application/messaging/SpokiDiagnosticsService';
import type { InspectionArchiveEntry } from '@/application/media/InspectionArchiveService';
import type { MediaCategory } from '@/domain/entities/media-asset';
import type { BoardStatus, DisplayStatus } from '@/modules/bay-displays/types';
import type { PublicStatus } from '@/modules/customer-portal/types';
import type {
  AppointmentActionRequest,
  QueueParams,
  QueueResponse,
} from '@/modules/reception/types';

const REQUEST_TIMEOUT_MS = 8_000;

/** Errore HTTP dell'API, con il codice applicativo restituito dal server. */
export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, unknown>> | undefined,
  ) {
    super(message);
  }
}

interface ErrorBody {
  readonly error?: {
    readonly code?: unknown;
    readonly message?: unknown;
    readonly details?: unknown;
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: ErrorBody | null = null;
  try {
    body = (await response.json()) as ErrorBody;
  } catch {
    body = null;
  }
  const code = typeof body?.error?.code === 'string' ? body.error.code : `HTTP_${response.status}`;
  const message =
    typeof body?.error?.message === 'string'
      ? body.error.message
      : `Errore ${response.status} dal server.`;
  const details = isRecord(body?.error?.details) ? body.error.details : undefined;
  return new ApiError(response.status, code, message, details);
}

function redirectToLogin(): void {
  if (typeof window !== 'undefined') {
    // Navigazione completa (non router): la sessione è scaduta e va rifatto il login.
    const next = `${window.location.pathname}${window.location.search}`;
    const target = new URL(`/login?next=${encodeURIComponent(next)}`, window.location.origin);
    window.location.href = target.toString();
  }
}

/** 403 PASSWORD_CHANGE_REQUIRED: la password provvisoria va sostituita prima di tutto il resto. */
function redirectToPasswordChange(): void {
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/cambia-password')) {
    const next = `${window.location.pathname}${window.location.search}`;
    const target = new URL(
      `/cambia-password?next=${encodeURIComponent(next)}`,
      window.location.origin,
    );
    window.location.href = target.toString();
  }
}

/** Richiesta JSON tipizzata; lancia `ApiError` su risposta non 2xx e `Error` su rete/timeout. */
export async function apiFetch<T>(
  path: string,
  init: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    json?: unknown;
    /** Rotte pubbliche (portale cliente): un 401 non deve mai portare al login dell'operatore. */
    publicEndpoint?: boolean;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (init.json !== undefined) {
    headers['content-type'] = 'application/json';
  }
  const response = await fetch(path, {
    method: init.method ?? 'GET',
    headers,
    body: init.json === undefined ? null : JSON.stringify(init.json),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!response.ok) {
    const error = await toApiError(response);
    if (response.status === 401 && init.publicEndpoint !== true) {
      redirectToLogin();
    }
    if (response.status === 403 && error.code === 'PASSWORD_CHANGE_REQUIRED') {
      redirectToPasswordChange();
    }
    throw error;
  }
  return (await response.json()) as T;
}

/** GET /api/v1/queue con i parametri della vista. */
export function fetchQueue(params: QueueParams): Promise<QueueResponse> {
  const search = new URLSearchParams();
  if (params.date !== null) {
    search.set('date', params.date);
  }
  if (params.deskId !== null && params.view === 'desk') {
    search.set('deskId', params.deskId);
  }
  search.set('view', params.view);
  return apiFetch<QueueResponse>(`/api/v1/queue?${search.toString()}`);
}

/** POST /api/v1/appointments/[id]/actions. */
export function postAppointmentAction(
  appointmentId: string,
  body: AppointmentActionRequest,
): Promise<{ readonly appointment: Appointment }> {
  return apiFetch(`/api/v1/appointments/${encodeURIComponent(appointmentId)}/actions`, {
    method: 'POST',
    json: body,
  });
}

/** POST /api/v1/appointments: pratica inserita a mano per un cliente senza appuntamento. */
export function postManualAppointment(body: {
  readonly plate: string;
  readonly customerName: string;
  readonly phone: string | null;
  readonly brandId: string;
  readonly deskId: string | null;
  readonly serviceDescription: string | null;
  readonly whatsappOptIn: boolean;
}): Promise<{ readonly appointment: Appointment }> {
  return apiFetch('/api/v1/appointments', { method: 'POST', json: body });
}

/** POST /api/v1/sync (sincronizzazione manuale). */
export function postSync(): Promise<{ readonly run: SyncRun }> {
  return apiFetch('/api/v1/sync', { method: 'POST' });
}

/**
 * GET /api/v1/public/status: stato pubblico della pratica per targa (portale cliente).
 * Endpoint anonimo: un errore non deve mai portare il cliente al login dell'operatore.
 */
export function fetchPublicStatus(
  targa: string,
  token: string | null = null,
): Promise<PublicStatus> {
  const search = new URLSearchParams();
  if (targa !== '') {
    search.set('targa', targa);
  }
  if (token !== null && token !== '') {
    search.set('t', token);
  }
  return apiFetch<PublicStatus>(`/api/v1/public/status?${search.toString()}`, {
    publicEndpoint: true,
  });
}

/**
 * POST /api/v1/public/late-notice: il cliente avvisa dal telefono che arriva in ritardo (+10 min).
 * Stesso contratto dello stato: la risposta è lo stato aggiornato della pratica.
 */
export function postPublicLateNotice(body: {
  readonly targa: string;
  readonly token?: string | null;
}): Promise<PublicStatus> {
  return apiFetch<PublicStatus>('/api/v1/public/late-notice', {
    method: 'POST',
    json: { targa: body.targa, t: body.token ?? undefined },
    publicEndpoint: true,
  });
}

/**
 * POST /api/v1/public/arrival: "sono arrivato", dalla pagina di tracciamento. La risposta è lo
 * stato aggiornato più `registered`, che dice se l'ora è stata presa adesso o era già segnata.
 */
export function postPublicArrival(body: {
  readonly targa: string;
  readonly token?: string | null;
}): Promise<PublicStatus & { readonly registered: boolean }> {
  return apiFetch('/api/v1/public/arrival', {
    method: 'POST',
    json: { targa: body.targa, t: body.token ?? undefined },
    publicEndpoint: true,
  });
}

/**
 * GET /api/v1/public/display: stato del monitor di una campata (kiosk senza sessione).
 * `bayRef` accetta il numero ("1") o il codice ("C1"); `token` è opzionale.
 */
export function fetchDisplayStatus(bayRef: string, token?: string | null): Promise<DisplayStatus> {
  const search = new URLSearchParams({ campata: bayRef });
  if (token !== undefined && token !== null && token !== '') {
    search.set('token', token);
  }
  return apiFetch<DisplayStatus>(`/api/v1/public/display?${search.toString()}`, {
    publicEndpoint: true,
  });
}

/** GET /api/v1/public/board: tabellone della sala d'attesa (kiosk senza sessione). */
export function fetchWaitingBoard(nextCount?: number): Promise<BoardStatus> {
  const search = new URLSearchParams();
  if (nextCount !== undefined) {
    search.set('prossimi', String(nextCount));
  }
  const query = search.size > 0 ? `?${search.toString()}` : '';
  return apiFetch<BoardStatus>(`/api/v1/public/board${query}`, { publicEndpoint: true });
}

/** Media dell'ispezione (foto o video) con l'indirizzo per rileggerlo. */
export interface InspectionPhoto {
  readonly id: string;
  readonly url: string;
  /** Foto o video: decide come mostrarlo (miniatura oppure lettore). */
  readonly kind: 'PHOTO' | 'VIDEO';
  readonly mimeType: string;
  readonly capturedAt: string;
  readonly sizeBytes: number;
  /** Parte del veicolo ripresa; `null` per i video e per le foto acquisite prima delle categorie. */
  readonly category: MediaCategory | null;
  /** File eliminato dalla retention: il record resta, l'immagine no. */
  readonly archivedAt: string | null;
}

/**
 * POST /api/v1/appointments/{id}/media: invia una foto o un video acquisiti al tablet.
 * La categoria è facoltativa: `null` per un video o per uno scatto libero fatto con il "+".
 * Il caricamento di un file non usa `apiFetch` perché il corpo è multipart, non JSON, e il
 * timeout dev'essere più generoso: un video da qualche decina di megabyte su rete lenta ci mette.
 */
export async function uploadInspectionMedia(
  appointmentId: string,
  file: File,
  category: MediaCategory | null,
): Promise<InspectionPhoto> {
  const body = new FormData();
  body.set('foto', file);
  if (category !== null) {
    body.set('categoria', category);
  }
  const response = await fetch(`/api/v1/appointments/${encodeURIComponent(appointmentId)}/media`, {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    const error = await toApiError(response);
    if (response.status === 401) {
      redirectToLogin();
    }
    throw error;
  }
  const payload = (await response.json()) as { readonly photo: InspectionPhoto };
  return payload.photo;
}

/** GET /api/v1/appointments/{id}/media: foto e video già acquisiti per la pratica. */
export function fetchInspectionPhotos(
  appointmentId: string,
): Promise<{ readonly photos: readonly InspectionPhoto[] }> {
  return apiFetch(`/api/v1/appointments/${encodeURIComponent(appointmentId)}/media`);
}

/** POST /api/v1/appointments/{id}/check-in: conclude l'accettazione al veicolo. */
export function postCheckIn(
  appointmentId: string,
  body: {
    readonly expectedVersion: number;
    readonly inspectionNotes: string | null;
  },
): Promise<{
  readonly appointment: Appointment;
  readonly photoCount: number;
  readonly videoCount: number;
  readonly crmNotified: boolean;
}> {
  return apiFetch(`/api/v1/appointments/${encodeURIComponent(appointmentId)}/check-in`, {
    method: 'POST',
    json: body,
  });
}

/** Parametri del cruscotto BDC: giornata da mostrare e se includere i lead già chiusi. */
export interface BdcLeadsParams {
  /** Giornata `YYYY-MM-DD`, oppure null per tutte quelle in memoria. */
  readonly businessDate: string | null;
  readonly includeHandled: boolean;
}

/** GET /api/v1/crm/leads: clienti da ricontattare (solo responsabile e amministratore). */
export function fetchBdcLeads(params: BdcLeadsParams): Promise<
  BdcLeadsView & {
    readonly businessDate: string | null;
  }
> {
  const search = new URLSearchParams({ giornata: params.businessDate ?? 'tutte' });
  if (params.includeHandled) {
    search.set('gestiti', '1');
  }
  return apiFetch(`/api/v1/crm/leads?${search.toString()}`);
}

/** POST /api/v1/crm/leads/{id}/contacted: chiude il lead dopo la telefonata del BDC. */
export function postLeadContacted(
  eventId: string,
  note: string | null,
): Promise<{ readonly lead: BdcLeadView }> {
  return apiFetch(`/api/v1/crm/leads/${encodeURIComponent(eventId)}/contacted`, {
    method: 'POST',
    json: { note },
  });
}

/**
 * POST /api/v1/admin/workstations/{id}/eject: l'amministratore scollega uno sportello rimasto
 * occupato da chi ha finito il turno. Non tocca la pratica eventualmente in carico.
 */
export function postWorkstationEject(workstationId: string): Promise<{
  readonly workstationId: string;
  readonly operatorName: string | null;
  readonly stillInProgressCode: string | null;
}> {
  return apiFetch(`/api/v1/admin/workstations/${encodeURIComponent(workstationId)}/eject`, {
    method: 'POST',
  });
}

/** Conservazione dei media di una pratica (solo amministratore): almeno un campo va indicato. */
export interface RetentionPatchInput {
  readonly legalHold?: boolean;
  readonly legalHoldReason?: string | null;
  readonly orderClosed?: boolean;
}

export interface RetentionStateView {
  readonly id: string;
  readonly code: string;
  readonly orderClosedAt: string | null;
  readonly legalHoldAt: string | null;
  readonly legalHoldReason: string | null;
}

export function patchAppointmentRetention(
  appointmentId: string,
  body: RetentionPatchInput,
): Promise<{ readonly appointment: RetentionStateView }> {
  return apiFetch(`/api/v1/admin/appointments/${encodeURIComponent(appointmentId)}/retention`, {
    method: 'PATCH',
    json: body,
  });
}

/** POST /api/v1/crm/leads/{id}/reopen: riporta un lead chiuso fra quelli da ricontattare. */
export function postLeadReopen(eventId: string): Promise<{ readonly lead: BdcLeadView }> {
  return apiFetch(`/api/v1/crm/leads/${encodeURIComponent(eventId)}/reopen`, { method: 'POST' });
}

/** POST /api/v1/system/close-day: chiude la giornata (responsabile e amministratore). */
export function postCloseDay(businessDate?: string): Promise<{
  readonly businessDate: string;
  readonly noShow: readonly string[];
  /** Pratiche ancora in carico chiuse d'ufficio (completate, da confermare). */
  readonly autoClosed: readonly string[];
  readonly failed: readonly string[];
  readonly alreadyClosed: number;
}> {
  return apiFetch('/api/v1/system/close-day', {
    method: 'POST',
    json: businessDate === undefined ? {} : { businessDate },
  });
}

/** GET /api/v1/crm/outbox: coda di uscita verso il CRM (solo amministratori). */
export function fetchCrmOutbox(statuses: readonly CrmOutboxStatus[] = []): Promise<CrmOutboxView> {
  const search = new URLSearchParams();
  if (statuses.length > 0) {
    search.set('stato', statuses.join(','));
  }
  const query = search.toString();
  return apiFetch(`/api/v1/crm/outbox${query === '' ? '' : `?${query}`}`);
}

/** POST /api/v1/crm/outbox/{id}/retry: forza un nuovo tentativo di consegna. */
export function postOutboxRetry(eventId: string): Promise<{
  readonly outcome: string;
  readonly event: CrmOutboxEvent;
}> {
  return apiFetch(`/api/v1/crm/outbox/${encodeURIComponent(eventId)}/retry`, { method: 'POST' });
}

/** GET /api/v1/reports/daily: indicatori della giornata (responsabile e amministratore). */
export function fetchDailyReport(businessDate: string): Promise<DailyReportView> {
  return apiFetch(`/api/v1/reports/daily?giornata=${encodeURIComponent(businessDate)}`);
}

/** Elenco operatori con sportelli e postazioni per i menu (solo ADMIN). */
export interface AdminOperatorsResponse {
  readonly operators: readonly OperatorView[];
  readonly desks: readonly { readonly id: string; readonly code: string; readonly name: string }[];
  readonly workstations: readonly {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly deskId: string;
  }[];
}

export function fetchAdminOperators(): Promise<AdminOperatorsResponse> {
  return apiFetch('/api/v1/admin/operators');
}

export function postAdminOperator(
  body: CreateOperatorInput,
): Promise<{ readonly operator: OperatorView }> {
  return apiFetch('/api/v1/admin/operators', { method: 'POST', json: body });
}

export function patchAdminOperator(
  id: string,
  body: UpdateOperatorInput,
): Promise<{ readonly operator: OperatorView }> {
  return apiFetch(`/api/v1/admin/operators/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    json: body,
  });
}

export function postAdminResetPassword(id: string): Promise<ResetPasswordResult> {
  return apiFetch(`/api/v1/admin/operators/${encodeURIComponent(id)}/reset-password`, {
    method: 'POST',
  });
}

/** GET /api/v1/admin/spoki: stato dell'integrazione WhatsApp e registro dei payload. */
export function fetchSpokiOverview(): Promise<SpokiOverview> {
  return apiFetch('/api/v1/admin/spoki');
}

/** POST /api/v1/admin/spoki/test: messaggio di prova a un numero scelto a mano. */
export function postSpokiTest(body: {
  readonly phone: string;
  readonly kind: SpokiTestKind;
  readonly firstName?: string | undefined;
}): Promise<SpokiTestResult> {
  return apiFetch('/api/v1/admin/spoki/test', { method: 'POST', json: body });
}

/** GET /api/v1/admin/assistance: accettazioni occupate e pratiche in carico. */
export function fetchAssistance(): Promise<AssistanceView> {
  return apiFetch('/api/v1/admin/assistance');
}

/** GET /api/v1/inspections/archive: storico dei check-in fotografici. */
export function fetchInspectionArchive(
  query: string,
): Promise<{ readonly query: string; readonly entries: readonly InspectionArchiveEntry[] }> {
  const search = new URLSearchParams();
  if (query !== '') {
    search.set('q', query);
  }
  const qs = search.toString();
  return apiFetch(`/api/v1/inspections/archive${qs === '' ? '' : `?${qs}`}`);
}

/** POST /api/v1/auth/login. */
export function postLogin(body: {
  readonly username: string;
  readonly password: string;
  readonly workstationId: string;
}): Promise<{ readonly session: Session }> {
  return apiFetch('/api/v1/auth/login', { method: 'POST', json: body });
}

/** POST /api/v1/auth/quick-login: accesso veloce di sviluppo con un profilo dev.* (404 in produzione). */
export function postQuickLogin(profile: string): Promise<{ readonly session: Session }> {
  return apiFetch('/api/v1/auth/quick-login', { method: 'POST', json: { profile } });
}

/** POST /api/v1/auth/change-password: sostituisce la password e rinnova la sessione. */
export function postChangePassword(body: {
  readonly currentPassword: string;
  readonly newPassword: string;
}): Promise<{ readonly session: Session }> {
  return apiFetch('/api/v1/auth/change-password', { method: 'POST', json: body });
}

/** POST /api/v1/auth/logout. */
export function postLogout(): Promise<{ readonly ok: boolean }> {
  return apiFetch('/api/v1/auth/logout', { method: 'POST' });
}
