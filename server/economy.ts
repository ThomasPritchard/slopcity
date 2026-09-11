import { CREDIT_LEADERBOARD_REFRESH_MS, type CreditLeaderboard } from '../shared/creditLeaderboard.ts';
import express, { type Application, type Request, type Response, type NextFunction } from 'express';
import { authenticateGuest,isAllowedOrigin } from './guest.ts';
import type { GuestRepository } from './persistence/guests.ts';
import { EconomyError, type EconomyRepository } from './persistence/economy.ts';
import type { WalletState } from '../shared/catalog.ts';
export function mountEconomyRoutes(app:Application,guests:GuestRepository,economy:EconomyRepository,hooks:{canPurchase:(profileId:string)=>boolean;onEquipped:(profileId:string,state:WalletState)=>void}){
 const router=express.Router();
 router.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');if(req.method!=='GET'&&!isAllowedOrigin(req.headers.origin)){res.status(403).json({code:'origin',error:'Origin not allowed'});return;}next();});
 router.use(express.json({limit:'2kb'}));
 router.use(async(req,res,next)=>{const guest=await authenticateGuest(req.headers.cookie,guests);if(!guest){res.status(401).json({code:'unauthenticated',error:'Restore your guest profile first'});return;}res.locals.profileId=guest.id;next();});
 router.get('/',async(_req,res)=>{res.json(await economy.ensure(res.locals.profileId));});
 let leaderboard: CreditLeaderboard | null = null, loading: Promise<CreditLeaderboard> | null = null;
 router.get('/leaderboard', async (_req, res) => {
  try {
   if (!leaderboard || Date.now() - leaderboard.updatedAt >= CREDIT_LEADERBOARD_REFRESH_MS) {
    if (!loading) loading = economy.creditLeaderboard().then(value => { leaderboard = value; return value; }).finally(() => { loading = null; });
    await loading;
   }
   res.json(leaderboard);
  } catch { res.status(503).json({ code: 'unavailable', error: 'The leaderboard is unavailable. Please check again shortly.' }); }
 });

 router.post('/purchase',async(req,res)=>{
  if(typeof req.body?.itemId!=='string'||typeof req.body?.requestId!=='string')throw new EconomyError('invalid_request','Choose an item and purchase request',400);
  res.json(await economy.purchase(res.locals.profileId,req.body.itemId,req.body.requestId,()=>hooks.canPurchase(res.locals.profileId)));
 });
 router.post('/equip',async(req,res)=>{
  if(typeof req.body?.itemId!=='string'||!Number.isSafeInteger(req.body?.expectedRevision)||req.body.expectedRevision<1)throw new EconomyError('invalid_request','Choose an owned item and current wardrobe revision',400);
  const state=await economy.equip(res.locals.profileId,req.body.itemId,req.body.expectedRevision);
  hooks.onEquipped(res.locals.profileId,state);res.json(state);
 });
 router.use((error:unknown,_req:Request,res:Response,_next:NextFunction)=>{
  if(error instanceof EconomyError){res.status(error.status).json({code:error.code,error:error.message,...(error.snapshot?{snapshot:error.snapshot}:{})});return;}
  const status=(error as {status?:number})?.status;
  if(status===400||status===413){res.status(status).json({code:'invalid_request',error:status===413?'Request too large':'Malformed JSON'});return;}
  res.status(503).json({code:'unavailable',error:'Credits could not be saved. Please retry shortly.'});
 });
 app.use('/api/economy',router);
}
