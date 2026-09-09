import type { PrivateGuestProfile } from '../../shared/profile';
import type { Profile } from '../../shared/world';
export class ProfileError extends Error { constructor(message: string, readonly status: number) { super(message); } }
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/game/api/${path}`, { method, credentials: 'same-origin', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new ProfileError(value.error || 'The guest service could not respond.', response.status);
  return value;
}
export async function restoreGuest(): Promise<PrivateGuestProfile | null> {
  try { return await request<PrivateGuestProfile>('profile'); }
  catch (error) { if (error instanceof ProfileError && error.status === 401) return null; throw error; }
}
export const establishGuest = (profile: Profile) => request<PrivateGuestProfile>('guest', 'POST', profile);
export const saveGuest = (profile: Profile, revision: number) => request<PrivateGuestProfile>('profile', 'PATCH', { ...profile, revision });
export const setGuestBlock = (profileId: string, blocked: boolean) => request<{ blocks: string[] }>(`blocks/${encodeURIComponent(profileId)}`, blocked ? 'PUT' : 'DELETE');
