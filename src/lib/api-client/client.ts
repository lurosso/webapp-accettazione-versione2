// Client HTTP tipizzato verso /api/v1 (solo lato browser). Timeout di 8 s, errori come `ApiError`
// con il codice di dominio del server; su 401 riporta al login conservando il percorso corrente.
import type { Appointment } from '@/domain/entities/appointment';
import type { SyncRun } from '@/domain/entities/sync-run';
import type { Session } from '@/application/auth/IAuthService';
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
  init: { method?: 'GET' | 'POST'; json?: unknown } = {},
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
    if (response.status === 401) {
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
