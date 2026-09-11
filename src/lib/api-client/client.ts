// Client HTTP tipizzato verso /api/v1 (solo lato browser). Timeout di 8 s, errori come `ApiError`
// con il codice di dominio del server; su 401 riporta al login conservando il percorso corrente.
import type { Appointment } from '@/domain/entities/appointment';
import type { SyncRun } from '@/domain/entities/sync-run';
import type { Session } from '@/application/auth/IAuthService';
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

/** Richiesta JSON tipizzata; lancia `ApiError` su risposta non 2xx e `Error` su rete/timeout. */
export async function apiFetch<T>(
  path: string,
  init: {
    method?: 'GET' | 'POST';
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

/** POST /api/v1/sync (sincronizzazione manuale). */
export function postSync(): Promise<{ readonly run: SyncRun }> {
  return apiFetch('/api/v1/sync', { method: 'POST' });
}

/**
 * GET /api/v1/public/status: stato pubblico della pratica per targa (portale cliente).
 * Endpoint anonimo: un errore non deve mai portare il cliente al login dell'operatore.
 */
export function fetchPublicStatus(targa: string): Promise<PublicStatus> {
  const search = new URLSearchParams({ targa });
  return apiFetch<PublicStatus>(`/api/v1/public/status?${search.toString()}`, {
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

/** Foto dell'ispezione con l'indirizzo per rileggerla. */
export interface InspectionPhoto {
  readonly id: string;
  readonly url: string;
  readonly capturedAt: string;
  readonly sizeBytes: number;
}

/**
 * POST /api/v1/appointments/{id}/media: invia una foto scattata al tablet.
 * Il caricamento di un file non usa `apiFetch` perché il corpo è multipart, non JSON, e il
 * timeout dev'essere più generoso: una foto da qualche megabyte su rete lenta richiede tempo.
 */
export async function uploadInspectionPhoto(
  appointmentId: string,
  file: File,
): Promise<InspectionPhoto> {
  const body = new FormData();
  body.set('foto', file);
  const response = await fetch(`/api/v1/appointments/${encodeURIComponent(appointmentId)}/media`, {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(30_000),
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

/** GET /api/v1/appointments/{id}/media: foto già acquisite per la pratica. */
export function fetchInspectionPhotos(
  appointmentId: string,
): Promise<{ readonly photos: readonly InspectionPhoto[] }> {
  return apiFetch(`/api/v1/appointments/${encodeURIComponent(appointmentId)}/media`);
}

/** POST /api/v1/appointments/{id}/check-in: conclude l'accettazione al veicolo. */
export function postCheckIn(
  appointmentId: string,
  body: { readonly expectedVersion: number; readonly inspectionNotes: string | null },
): Promise<{
  readonly appointment: Appointment;
  readonly photoCount: number;
  readonly crmNotified: boolean;
}> {
  return apiFetch(`/api/v1/appointments/${encodeURIComponent(appointmentId)}/check-in`, {
    method: 'POST',
    json: body,
  });
}

/** POST /api/v1/auth/login. */
export function postLogin(body: {
  readonly username: string;
  readonly password: string;
  readonly workstationId: string;
}): Promise<{ readonly session: Session }> {
  return apiFetch('/api/v1/auth/login', { method: 'POST', json: body });
}

/** POST /api/v1/auth/logout. */
export function postLogout(): Promise<{ readonly ok: boolean }> {
  return apiFetch('/api/v1/auth/logout', { method: 'POST' });
}
