import express, { type Application, type NextFunction, type Request, type Response, type Router } from 'express';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { authenticateGuest } from './guest.ts';
import { clientAddress } from './clientAddress.ts';
import type { GuestRepository } from './persistence/guests.ts';
import { SafetyError, type SafetyService } from './safety.ts';

export function safetyResponse(error: unknown, res: Response): void {
 const known=error instanceof SafetyError;
 res.setHeader('Cache-Control','no-store');
 if(known&&error.status===429)res.setHeader('Retry-After',String(error.retryAfter));
 res.status(known?error.status:503).json({code:known?error.codeName:'unavailable',error:known?error.message:'Safety service temporarily unavailable. Please retry.'});
}

export function guardHttpRequest(safety: SafetyService) {
 return (req: IncomingMessage,res: ServerResponse): boolean => {
  const path=(req.url??'/').split('?')[0];
  if(path==='/health')return true;
  try {
   const ip=clientAddress(req.headers);
   if(!ip){safety.count('untrusted_proxy');throw new SafetyError(503,'untrusted_proxy','The game gateway is not configured correctly.');}
   if(path==='/api/community/admin'||path.startsWith('/api/community/admin/'))return true;
   safety.count('http_requests');safety.checkBan(ip);safety.limit('api',ip);
   if(path.startsWith('/matchmake/'))safety.limit('join',ip);
   return true;
  }catch(error){
   const known=error instanceof SafetyError;
   res.statusCode=known?error.status:503;res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
   if(known&&error.status===429)res.setHeader('Retry-After',String(error.retryAfter));
   res.end(JSON.stringify({code:known?error.codeName:'unavailable',error:known?error.message:'Safety service temporarily unavailable.'}));return false;
  }
 };
}

export function mountSafetyGuards(app: Application, safety: SafetyService, guests: GuestRepository) {
 app.use(async(req,res,next)=>{
  // Admin access remains available even when the administrator's guest/network is banned.
  // Existing admin authentication, origin and login quotas protect that separate surface.
  if(req.path==='/health'||req.path==='/api/community/admin'||req.path.startsWith('/api/community/admin/')){next();return;}
  try {
   const ip=clientAddress(req.headers);
   if(!ip){safety.count('untrusted_proxy');throw new SafetyError(503,'untrusted_proxy','The game gateway is not configured correctly.');}
   if(req.path.startsWith('/api/')){
    const profile=await authenticateGuest(req.headers.cookie,guests);
    if(profile)safety.checkProfile(ip,profile);
   }
   next();
  }catch(error){safetyResponse(error,res);}
 });
}

// Called only behind the community admin session and origin middleware.
export function mountSafetyAdmin(router: Router, safety: SafetyService) {
 router.get('/admin/safety',(_req,res)=>res.json(safety.snapshot()));
 router.get('/admin/safety/guests',async(req,res)=>{
  const q=req.query.q;
  if(typeof q!=='string'||!q.trim()||q.length>100)throw new SafetyError(400,'invalid_search','Enter a guest name or ID (up to 100 characters).');
  res.json({guests:await safety.repository.search(q.trim())});
 });
 router.post('/admin/safety/bans',express.json({limit:'2kb'}),async(req,res)=>res.status(201).json(await safety.addBan(req.body)));
 router.delete('/admin/safety/bans/:id',async(req,res)=>{await safety.revokeBan(req.params.id as string);res.sendStatus(204);});
 router.use('/admin/safety',(error:unknown,_req:Request,res:Response,_next:NextFunction)=>{
  if(error instanceof Error && ['Guest not found','Lift an existing ban before adding more'].includes(error.message))error=new SafetyError(400,'invalid_ban',error.message);
  safetyResponse(error,res);
 });
}
