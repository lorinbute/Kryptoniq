// Minimal API client. Mutations carry X-Sentiq (the server's CSRF guard).
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly suggestions: string[];
  constructor(status: number, code: string, message: string, details?: unknown, suggestions: string[] = []) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.suggestions = suggestions;
  }
}

let sessionEpoch = 0;
/**
 * A sign-in or sign-out happened: answers to requests sent before it belong to the previous user and are dropped
 * (a late save of user A must not land in user B's screens).
 */
export function newSessionEpoch(): void {
  sessionEpoch++;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const epoch = sessionEpoch;
  const headers: Record<string, string> = {};
  if (method !== 'GET') headers['X-Sentiq'] = '1';
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'OFFLINE', 'Serverul Sentiq nu răspunde. Pornește-l cu `scripts/sentiq.sh start`.');
  }
  const text = await res.text();
  if (epoch !== sessionEpoch) throw new ApiError(0, 'STALE', 'Răspunsul era pentru sesiunea anterioară.');
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string; details?: unknown; suggestions?: string[] } } | null)?.error;
    // The session ended (signed out elsewhere, disabled, expired): the app goes back to the sign-in screen.
    if (res.status === 401 && err?.code === 'AUTH_REQUIRED') window.dispatchEvent(new Event('sentiq:signed-out'));
    // The account has no two-factor (FD-2FA; e.g. a tab older than the auth state): the app shows the setup.
    if (res.status === 403 && err?.code === 'TWO_FACTOR_REQUIRED') window.dispatchEvent(new Event('sentiq:two-factor-required'));
    throw new ApiError(res.status, err?.code ?? 'HTTP', err?.message ?? `HTTP ${res.status}`, err?.details, err?.suggestions ?? []);
  }
  return json as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  del: <T>(url: string) => request<T>('DELETE', url),
};

export function qs(params: Record<string, string | number | boolean | undefined | null | string[]>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    sp.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
