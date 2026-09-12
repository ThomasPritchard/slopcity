import type { AdmissionService } from './admission.ts';
import { createHash } from 'node:crypto';
import type { AccountRepository } from './persistence/accounts.ts';
import type { TwitchLiveService, TwitchLiveSnapshot } from './twitchLive.ts';
import express,{type Application,type Request,type Response,type NextFunction} from 'express';
import sharp from 'sharp';
import { clientAddress, networkKey } from './clientAddress.ts';
import { mountSafetyAdmin } from './safetyRoutes.ts';
import { SafetyError, type SafetyService } from './safety.ts';
import { authenticateGuest,isAllowedOrigin } from './guest.ts';
import { validProfileId,type GuestRepository } from './persistence/guests.ts';
import { CommunityError,type CommunityRepository } from './persistence/community.ts';
import { COMMUNITY_LIMITS as LIMITS,BRIDGEMIND_TWITCH_CHANNEL,type ProgrammeSettings,type Programme } from '../shared/community.ts';
import { CommunityAdminSessions,RequestLimiter,verifyCommunityPassword } from './communityAuth.ts';
export async function normalizeCommunityImage(base64:unknown){
 if(typeof base64!=='string'||!base64.length||base64.length>Math.ceil(LIMITS.inputBytes/3)*4||(base64.length%4!==0||! /^[A-Za-z0-9+/]+={0,2}$/.test(base64)))throw new CommunityError('Choose a JPEG, PNG or WebP image up to 4 MiB');
 const input=Buffer.from(base64,'base64');if(input.length>LIMITS.inputBytes)throw new CommunityError('Image exceeds 4 MiB',413);
 try{
  // libvips can decode only the first frame of APNG, so reject its animation control chunk explicitly.
  if(input.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){for(let offset=8;offset+12<=input.length;){const length=input.readUInt32BE(offset);if(input.toString('ascii',offset+4,offset+8)==='acTL')throw new Error('animated');if(length>input.length-offset-12)throw new Error('truncated');offset+=length+12;}}
  const decoder=sharp(input,{limitInputPixels:LIMITS.pixels,failOn:'warning'});const metadata=await decoder.metadata();if(!['jpeg','png','webp'].includes(metadata.format??'')||(metadata.pages??1)>1)throw new Error('format');const {data,info}=await decoder.rotate().resize({width:1920,height:1080,fit:'inside',withoutEnlargement:true}).webp({quality:82}).toBuffer({resolveWithObject:true});if(data.length>LIMITS.outputBytes)throw new CommunityError('Normalised image exceeds 1 MiB');return {data,width:info.width,height:info.height};}catch(error){if(error instanceof CommunityError)throw error;throw new CommunityError('Use a valid still JPEG, PNG or WebP image up to 12 megapixels');}
}
function text(value:unknown,max:number,required=false):string {if(typeof value!=='string'||value.trim().length>max||(required&&!value.trim()))throw new CommunityError('Invalid title or credit');return value.trim();}
export function validateProgramme(value:any):ProgrammeSettings {
 if(!value||!['intermission','live'].includes(value.mode)||!['twitch','youtube'].includes(value.platform)||typeof value.twitchChannel!=='string'||value.twitchChannel.toLowerCase()!==BRIDGEMIND_TWITCH_CHANNEL||typeof value.youtubeVideoId!=='string'||(value.youtubeVideoId!==''&&!/^[a-zA-Z0-9_-]{11}$/.test(value.youtubeVideoId))||!Array.isArray(value.schedule)||value.schedule.length>20)throw new CommunityError('Invalid programme settings');
 if(value.mode==='live'&&value.platform==='youtube'&&!value.youtubeVideoId)throw new CommunityError('Enter a YouTube video ID');
 const ids=new Set<string>();const schedule=value.schedule.map((entry:any)=>{if(!entry||typeof entry.id!=='string'||! /^[A-Za-z0-9_-]{1,64}$/.test(entry.id)||ids.has(entry.id)||!['twitch','youtube'].includes(entry.platform)||typeof entry.startsAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(entry.startsAt)||(!Number.isFinite(Date.parse(entry.startsAt))||new Date(entry.startsAt).toISOString().slice(0,19)!==entry.startsAt.slice(0,19)))throw new CommunityError('Invalid schedule entry');ids.add(entry.id);return {id:entry.id,title:text(entry.title,100,true),startsAt:new Date(entry.startsAt).toISOString(),platform:entry.platform};});
 return {mode:value.mode,platform:value.platform,twitchChannel:BRIDGEMIND_TWITCH_CHANNEL,youtubeVideoId:value.youtubeVideoId,schedule};
}
export function resolveCommunityProgramme(programme:Programme,detection?:TwitchLiveSnapshot):Programme {
 if(!detection)return programme;
 const liveDetection={status:detection.status,checkedAt:detection.checkedAt};
 if(detection.isLive===true)return {...programme,mode:'live',platform:'twitch',twitchChannel:BRIDGEMIND_TWITCH_CHANNEL,liveDetection};
 return {...programme,mode:programme.mode==='live'&&programme.platform==='youtube'?'live':'intermission',liveDetection};
}
export function mountCommunityRoutes(app:Application,guests:GuestRepository,repository:CommunityRepository,options:{passwordHash?:string;adminSessions?:CommunityAdminSessions;safety?:SafetyService;admission?:AdmissionService;accounts?:AccountRepository;twitchLive?:Pick<TwitchLiveService,'snapshot'>}={}){
 const router=express.Router(),sessions=options.adminSessions??new CommunityAdminSessions();const passwordHash=options.passwordHash??process.env.COMMUNITY_ADMIN_PASSWORD_HASH??'';
 router.use((req,res,next)=>{if(options.safety&&!clientAddress(req.headers)){res.status(503).json({error:'Game gateway unavailable.'});return;}next();});
 const loginIP=new RequestLimiter(5,15*60_000),loginGlobal=new RequestLimiter(50,15*60_000),uploadGuest=new RequestLimiter(10,60*60_000),uploadIP=new RequestLimiter(30,60*60_000),uploadGlobal=new RequestLimiter(100,60*60_000);let decoders=0;
 const uploadRequests = new RequestLimiter(120,60*60_000);
 const challenge = () => ({enabled: options.admission?.enabled ?? true, siteKey: options.admission?.config.siteKey ?? ''});
 async function submissionStatus(req:Request, admin:boolean) {
  const profile = await authenticateGuest(req.headers.cookie,guests);
  const state = await repository.protectionStatus();
  const network = networkKey(clientAddress(req.headers) ?? req.socket.remoteAddress ?? 'unknown');
  const cooldownUntil = admin ? null : Math.max(0, state.accountCooldowns.find(c=>c.key===profile?.id)?.until ?? 0,state.networkCooldowns.find(c=>c.key===network)?.until ?? 0) || null;
  return {eligible:admin || !!profile && (await options.accounts?.status(profile.id))?.kind === 'member', challenge:challenge(), paused:state.pending>=LIMITS.pendingGlobal || !admin && (state.reasons.length>0 || !!cooldownUntil), reasons:state.reasons, pending:state.pending, retryAt:state.spamPauseUntil, cooldownUntil, trialUntil:state.trialUntil};
 }
 router.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');if(!['GET','HEAD'].includes(req.method)&&!isAllowedOrigin(req.headers.origin)){res.status(403).json({error:'Origin not allowed'});return;}res.locals.admin=sessions.valid(req.headers.cookie);next();});
 router.post('/admin/login',(req,res,next)=>{if(!passwordHash){res.status(503).json({error:'Community administration is not configured'});return;}if(!loginGlobal.take('all')||!loginIP.take(clientAddress(req.headers)??req.socket.remoteAddress??'unknown')){res.status(429).json({error:'Too many login attempts'});return;}next();},express.json({limit:'2kb'}),async(req,res)=>{if(typeof req.body?.password!=='string'||!await verifyCommunityPassword(req.body.password,passwordHash)){res.status(401).json({error:'Invalid password'});return;}res.setHeader('Set-Cookie',sessions.cookie(sessions.create(),req.headers.origin?.startsWith('https:')??false));res.sendStatus(204);});
 router.get('/programme',async(_req,res)=>res.json(resolveCommunityProgramme(await repository.programme(),options.twitchLive?.snapshot())));
 router.get('/submission-status',async(req,res)=>res.json(await submissionStatus(req,res.locals.admin)));
 router.get('/images/:id',async(req,res)=>{if(!validProfileId(req.params.id))throw new CommunityError('Image unavailable',404);const bytes=await repository.image(req.params.id,{public:true});if(!bytes)throw new CommunityError('Image unavailable',404);res.type('image/webp').send(bytes);});
 router.use('/admin',(req,res,next)=>{if(!res.locals.admin){res.status(401).json({error:passwordHash?'Administrator sign-in required':'Community administration is not configured',configured:!!passwordHash});return;}next();});
 const adminRequests=new RequestLimiter(180,60_000);
 router.use('/admin',(req,res,next)=>{if(!adminRequests.take(sessions.token(req.headers.cookie))){res.setHeader('Retry-After','60');res.status(429).json({error:'Too many admin requests. Please wait.'});return;}next();});
 if(options.safety)mountSafetyAdmin(router,options.safety,options.admission);
 router.post('/admin/logout',(req,res)=>{sessions.revoke(req.headers.cookie);res.setHeader('Set-Cookie',sessions.cookie('',req.headers.origin?.startsWith('https:')??false));res.sendStatus(204);});
 router.get('/admin',async(_req,res)=>{const programme=await repository.programme();const {mode,platform,twitchChannel,youtubeVideoId,schedule}=programme;res.json({programme:resolveCommunityProgramme(programme,options.twitchLive?.snapshot()),settings:{mode,platform,twitchChannel,youtubeVideoId,schedule},images:await repository.list(),configured:true});});
 router.use('/admin',express.json({limit:'16kb'}));
 router.get('/admin/submissions',async(_req,res)=>res.json(await repository.protectionStatus()));
 router.patch('/admin/submissions',async(req,res)=>{
  if(!['pause','resume','clear-cooldown'].includes(req.body?.action) || req.body.action==='clear-cooldown' && !validProfileId(req.body.profileId)) throw new CommunityError('Choose a valid submission control');
  res.json(await repository.changeProtection(req.body));
 });
 router.patch('/admin/images/:id',async(req,res)=>{const p=req.body;if(!validProfileId(req.params.id)||!p||!Object.keys(p).length||Object.keys(p).some(k=>!['status','featured','sortOrder'].includes(k))||(p.status!==undefined&&!['approved','rejected'].includes(p.status))||(p.featured!==undefined&&typeof p.featured!=='boolean')||(p.sortOrder!==undefined&&(!Number.isSafeInteger(p.sortOrder)||Math.abs(p.sortOrder)>10000)))throw new CommunityError('Invalid moderation change');res.json(await repository.moderate(req.params.id,p));});
 router.delete('/admin/images/:id',async(req,res)=>{if(!validProfileId(req.params.id))throw new CommunityError('Image unavailable',404);await repository.remove(req.params.id);res.sendStatus(204);});
 router.put('/admin/programme',async(req,res)=>{if(!Number.isSafeInteger(req.body?.expectedRevision)||req.body.expectedRevision<1)throw new CommunityError('Current programme revision required');res.json(resolveCommunityProgramme(await repository.update(validateProgramme(req.body),req.body.expectedRevision),options.twitchLive?.snapshot()));});
 router.use('/submissions',async(req,res,next)=>{
  const guest=await authenticateGuest(req.headers.cookie,guests);
  if(!guest&&!res.locals.admin){res.status(401).json({error:'Restore your guest profile first'});return;}
  res.locals.owner=guest?.id??null;
  if(req.method==='POST'){
   if(!res.locals.admin && (!options.accounts || (await options.accounts.status(guest!.id)).kind!=='member')){res.status(403).json({error:'Save your guest to a verified email account before submitting images.'});return;}
   res.locals.network=networkKey(clientAddress(req.headers)??req.socket.remoteAddress??'unknown');
   if(!uploadRequests.take(res.locals.network)){res.status(429).json({error:'Too many submission requests. Please try later.'});return;}
  }
  next();
 });
 router.get('/submissions',async(_req,res)=>res.json({submissions:res.locals.owner?await repository.list(res.locals.owner):await repository.list()}));
 router.get('/submissions/:id/image',async(req,res)=>{if(!validProfileId(req.params.id))throw new CommunityError('Image unavailable',404);const bytes=await repository.image(req.params.id,{admin:res.locals.admin,owner:res.locals.owner});if(!bytes)throw new CommunityError('Image unavailable',404);res.setHeader('Cache-Control','private, no-store');res.type('image/webp').send(bytes);});
 router.post('/submissions',express.json({limit:'6mb'}),async(req,res)=>{
  if(!validProfileId(req.body?.requestId))throw new CommunityError('A valid upload request ID is required');
  const payloadHash=createHash('sha256').update(JSON.stringify([req.body.title??null,req.body.credit??null,req.body.imageBase64??null])).digest('hex');
  const owner=res.locals.admin?null:res.locals.owner;
  const replay=await repository.replay(owner??'admin',req.body.requestId,payloadHash);
  if(replay){res.status(replay.status).json(replay.body);return;}
  const status=await submissionStatus(req,res.locals.admin);
  if(status.paused)throw new CommunityError(status.cooldownUntil?'Uploads from this account or network are cooling down. Please try later.':'Image submissions are temporarily paused while the queue is reviewed. Please try later.',429);
  // Exhausted accounts and networks cannot spend the shared work allowance.
  if(!uploadIP.take(res.locals.network)||!uploadGuest.take(owner??'admin'))throw new CommunityError('Submission rate limit reached',429);
  if(!options.admission)throw new CommunityError('Upload verification is unavailable',503);
  await options.admission.verify(req.body.turnstileToken,clientAddress(req.headers)??req.socket.remoteAddress??'127.0.0.1','community_upload');
  if(decoders>=2)throw new CommunityError('Image processor busy. Please retry.',429);
  if(!uploadGlobal.take('all'))throw new CommunityError('Submission rate limit reached',429);
  let title='',credit='',image:Awaited<ReturnType<typeof normalizeCommunityImage>>|undefined,invalid:string|undefined,invalidStatus:number|undefined;
  decoders++;
  try{title=text(req.body.title,100,true);credit=text(req.body.credit,80);image=await normalizeCommunityImage(req.body.imageBase64);}
  catch(error){if(!(error instanceof CommunityError))throw error;invalid=error.message;invalidStatus=error.status;}
  finally{decoders--;}
  if(!res.locals.admin){const current=await authenticateGuest(req.headers.cookie,guests);if(!current||current.id!==owner)throw new CommunityError('Your session changed. Please sign in again.',401);options.safety?.checkProfile(clientAddress(req.headers)??'127.0.0.1',current);}
  const result=await repository.submitProtected({owner,admin:res.locals.admin,network:res.locals.network,requestId:req.body.requestId,payloadHash,title,credit,image,invalid,invalidStatus});
  res.status(result.status).json(result.body);
 });
 router.use((error:unknown,_req:Request,res:Response,_next:NextFunction)=>{if(error instanceof CommunityError||error instanceof SafetyError){res.status(error.status).json({error:error.message});return;}const status=(error as {status?:number})?.status;if(status===400||status===413){res.status(status).json({error:status===413?'Request too large':'Malformed JSON'});return;}res.status(503).json({error:'Community service unavailable. Please retry shortly.'});});
 app.use('/api/community',router);
}
