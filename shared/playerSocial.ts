import type { WalletState } from './catalog.ts';
export interface SocialPerson { profileId:string; name:string; online:boolean }
export interface SocialSnapshot { friends:SocialPerson[]; incoming:SocialPerson[]; outgoing:SocialPerson[]; giftingAllowance:number }
export type FriendAction = 'request'|'accept'|'decline'|'cancel'|'remove';
export interface GiftReceipt { requestId:string; targetId:string; amount:number; wallet:WalletState; giftingAllowance:number; replayed:boolean }
export const MAX_GIFT_CREDITS=1000;
export const GIFT_DISTANCE=3;
