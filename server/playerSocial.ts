import express, { type Application, type Request, type Response, type NextFunction } from 'express';
import { authenticateGuest,isAllowedOrigin } from './guest.ts';
import type { GuestRepository } from './persistence/guests.ts';
import { EconomyError } from './persistence/economy.ts';
import type { SocialRepository } from './persistence/social.ts';
import { GIFT_DISTANCE } from '../shared/playerSocial.ts';
export interface SocialPresence { sessionId:string; roomId:string; x:number; z:number }
export interface SocialHooks { presence:(id:string)=>SocialPresence|undefined; changed:(ids:string[])=>void; gifted:(ids:string[])=>Promise<void> }
export function mountPlayerSocialRoutes(app:Application,guests:GuestRepository,social:SocialRepository,hooks:SocialHooks){
 const router=express.Router();const limits=new Map<string,{until:number;count:number}>();
 router.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store');if(req.method!=='GET'&&!isAllowedOrigin(req.headers.origin)){res.status(403).json({code:'origin',error:'Origin not allowed'});return;}next();});
 router.use(express.json({limit:'2kb'}));
 router.use(async(req,res,next)=>{const guest=await authenticateGuest(req.headers.cookie,guests);if(!guest){res.status(401).json({code:'unauthenticated',error:'Restore your guest profile first'});return;}res.locals.profileId=guest.id;
  if(req.method!=='GET'){const now=Date.now();for(const [id,value] of limits)if(value.until<=now)limits.delete(id);const value=limits.get(guest.id)??{until:now+60000,count:0};limits.set(guest.id,value);if(++value.count>60){res.setHeader('Retry-After',String(Math.ceil((value.until-now)/1000)));res.status(429).json({code:'rate_limit',error:'Please wait before trying again'});return;}}
  next();
 });
 const snapshot=(id:string)=>social.snapshot(id,target=>!!hooks.presence(target));
 router.get('/',async(_req,res)=>{res.json(await snapshot(res.locals.profileId));});
 router.post('/friends',async(req,res)=>{
  await social.friend(res.locals.profileId,req.body?.targetId,req.body?.action);
  hooks.changed([res.locals.profileId,req.body.targetId]);res.json(await snapshot(res.locals.profileId));
 });
 router.post('/gifts',async(req,res)=>{
  const id=res.locals.profileId,target=req.body?.targetId;
  const receipt=await social.gift(id,target,req.body?.amount,req.body?.requestId,()=>{
   const a=hooks.presence(id),b=hooks.presence(target);
   return !!a&&!!b&&a.roomId===b.roomId&&Math.hypot(a.x-b.x,a.z-b.z)<=GIFT_DISTANCE;
  });
  // A publication failure must not turn a committed gift into an apparent failure.
  if(!receipt.replayed){hooks.changed([id,target]);await hooks.gifted([id,target]).catch(()=>{});}
  res.json(receipt);
 });
 router.use((error:unknown,_req:Request,res:Response,_next:NextFunction)=>{
  if(error instanceof EconomyError){res.status(error.status).json({code:error.code,error:error.message});return;}
  const status=(error as {status?:number})?.status;
  if(status===400||status===413){res.status(status).json({code:'invalid_request',error:status===413?'Request too large':'Malformed JSON'});return;}
  res.status(503).json({code:'unavailable',error:'Social changes could not be saved. Please retry shortly.'});
 });
 app.use('/api/social',router);
}
