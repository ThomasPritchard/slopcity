const BASE = '/game/api/community';

export class CommunityApiError extends Error {
 constructor(message: string, public readonly status: number, public readonly configured?: boolean) { super(message); }
}

export async function communityRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
 const response = await fetch(`${BASE}${path}`, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
 if (!response.ok) {
  const body = await response.json().catch(() => null) as { error?: string; configured?: boolean } | null;
  throw new CommunityApiError(body?.error || 'The community board could not be reached. Please try again.', response.status, body?.configured);
 }
 return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export const communityError = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
