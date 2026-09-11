import { FIRST_MEMORY } from './memories.ts';
export const BRIDGEMIND_TWITCH_CHANNEL = 'bridgemindai';
export interface CommunityImage { id:string; title:string; credit:string; imageUrl:string; width:number; height:number; featured:boolean; sortOrder:number }
export interface CommunitySubmission extends CommunityImage { status:'pending'|'approved'|'rejected'; createdAt:string }
export interface ScheduleEntry { id:string; title:string; startsAt:string; platform:'twitch'|'youtube' }
// YouTube video IDs are manually curated by the trusted administrator; ownership is not API-verified.
export interface Programme { revision:number; epochMs:number; serverNowMs:number; mode:'intermission'|'live'; platform:'twitch'|'youtube'; twitchChannel:string; youtubeVideoId:string; schedule:ScheduleEntry[]; images:CommunityImage[] }
export type ProgrammeSettings = Pick<Programme,'mode'|'platform'|'twitchChannel'|'youtubeVideoId'|'schedule'>;
export const COMMUNITY_LIMITS = { inputBytes:4*1024*1024, pixels:12_000_000, outputBytes:1024*1024, pendingPerGuest:5, pendingGlobal:50, retained:200, dailyPerGuest:10, dailyGlobal:100, slideMs:20_000 } as const;
export const FIRST_COMMUNITY_IMAGE:CommunityImage = { id:'first-memory', title:FIRST_MEMORY.title, credit:'', imageUrl:FIRST_MEMORY.image, width:1122, height:1402, featured:true, sortOrder:-1 };
export function communityImages(images:CommunityImage[]):CommunityImage[] { return [FIRST_COMMUNITY_IMAGE,...images.filter(image=>image.id!==FIRST_COMMUNITY_IMAGE.id)]; }
export type CommunitySlide = { kind:'image'; image:CommunityImage } | { kind:'schedule' } | { kind:'live' };
export function communitySlides(images:CommunityImage[]):CommunitySlide[] { const result:CommunitySlide[]=[]; communityImages(images).forEach((image,index)=>{result.push({kind:'image',image});if((index+1)%3===0)result.push({kind:'schedule'});});if(result.at(-1)?.kind!=='schedule')result.push({kind:'schedule'});return result; }
export function communitySlide(programme:Programme,serverNowMs=programme.serverNowMs):CommunitySlide { if(programme.mode==='live')return {kind:'live'};const slides=communitySlides(programme.images);return slides[Math.floor(Math.max(0,serverNowMs-programme.epochMs)/COMMUNITY_LIMITS.slideMs)%slides.length]; }

export const programmeSlide = communitySlide;
