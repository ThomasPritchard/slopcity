import type { FriendAction, GiftReceipt, SocialSnapshot } from '../../shared/playerSocial';
export class SocialError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`/game/api/social${path}`, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
    const value = await response.json();
    if (!response.ok) throw new SocialError(value.error || 'That change could not be saved.', response.status);
    return value as T;
  } finally { clearTimeout(timer); }
}
export const getSocial = () => request<SocialSnapshot>('');
export const changeFriend = (targetId: string, action: FriendAction) => request<SocialSnapshot>('/friends', { targetId, action });
export const giveCredits = (targetId: string, amount: number, requestId: string) => request<GiftReceipt>('/gifts', { targetId, amount, requestId });
