const BASE = '/game/api/account';

export class AccountApiError extends Error {
 constructor(message: string, public readonly status: number) { super(message); }
}

export async function accountRequest<T>(path = '', options: RequestInit = {}): Promise<T> {
 const response = await fetch(`${BASE}${path}`, {
  credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15_000), ...options,
  headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
 });
 if (!response.ok) {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  throw new AccountApiError(body?.error || 'Your account could not be reached. Please try again.', response.status);
 }
 return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export const accountError = (cause: unknown) => cause instanceof Error && cause.name !== 'TimeoutError' && cause.name !== 'TypeError' && cause.name !== 'AbortError'
 ? cause.message : 'Your account could not be reached. Check your connection, then try again.';

/** Remove the bearer token before analytics, media or other requests can run. */
export function captureAccountLink(): string | null {
 const hash = window.location.hash;
 if (!hash.startsWith('#account=')) return null;
 window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
 return /^#account=([A-Za-z0-9_-]{43})$/.exec(hash)?.[1] ?? null;
}
