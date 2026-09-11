import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const derive=promisify(scrypt);
export async function hashCommunityPassword(password:string):Promise<string> { const salt=randomBytes(16).toString('hex');return `scrypt:${salt}:${(await derive(password,salt,64) as Buffer).toString('hex')}`; }
export async function verifyCommunityPassword(password:string,encoded:string):Promise<boolean> { if(!/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(encoded)||password.length>1024)return false;const [,salt,expected]=encoded.split(':');return timingSafeEqual(await derive(password,salt,64) as Buffer,Buffer.from(expected,'hex')); }
export class RequestLimiter {
 private buckets=new Map<string,{count:number;until:number}>();
 constructor(private maximum:number,private duration:number,private capacity=2000){}
 take(key:string,now=Date.now()):boolean { for(const [key,b] of this.buckets)if(b.until<=now)this.buckets.delete(key);let bucket=this.buckets.get(key);if(!bucket){if(this.buckets.size>=this.capacity)return false;bucket={count:0,until:now+this.duration};this.buckets.set(key,bucket);}return ++bucket.count<=this.maximum; }
}
export const ADMIN_COOKIE='slop_community_admin';
export class CommunityAdminSessions {
 private sessions=new Map<string,number>();
 readonly ttl=8*60*60*1000;
 private hash(token:string){return createHash('sha256').update(token).digest('hex');}
 token(cookie:string|undefined){return cookie?.split(';').map(p=>p.trim()).find(p=>p.startsWith(`${ADMIN_COOKIE}=`))?.slice(ADMIN_COOKIE.length+1)??'';}
 valid(cookie:string|undefined,now=Date.now()){for(const [key,until] of this.sessions)if(until<=now)this.sessions.delete(key);return (this.sessions.get(this.hash(this.token(cookie)))??0)>now;}
 create(now=Date.now()){this.valid(undefined,now);if(this.sessions.size>=20)this.sessions.delete(this.sessions.keys().next().value!);const token=randomBytes(32).toString('base64url');this.sessions.set(this.hash(token),now+this.ttl);return token;}
 revoke(cookie:string|undefined){this.sessions.delete(this.hash(this.token(cookie)));}
 cookie(token:string,secure:boolean){return `${ADMIN_COOKIE}=${token}; Path=/game/api/community; HttpOnly; SameSite=Strict; Max-Age=${token?this.ttl/1000:0}${secure?'; Secure':''}`;}
}
