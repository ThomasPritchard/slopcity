import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import type { EconomyRepository } from './economy.ts';
import { COMMUNITY_LIMITS as LIMITS, BRIDGEMIND_TWITCH_CHANNEL, communityImages, type CommunitySubmission, type Programme, type ProgrammeSettings } from '../../shared/community.ts';
import { createSubmissionProtectionState, inspectSubmissionProtection, admitSubmission, recordInvalidSubmission, setSubmissionManualPause, clearSubmissionAccountCooldown, type SubmissionProtectionState } from '../submissionProtection.ts';
import type { SubmissionProtectionSnapshot } from '../../shared/submissionProtection.ts';
export interface ProtectedSubmissionInput { owner:string|null; admin:boolean; network:string; requestId:string; payloadHash:string; title:string; credit:string; image?:{data:Buffer;width:number;height:number}; invalid?:string; invalidStatus?:number }
export interface ProtectedSubmissionResult { status:number; body:CommunitySubmission|{error:string} }
export class CommunityError extends Error { constructor(message:string,readonly status=400){super(message);} }
const columns='id,title,credit,status,width,height,featured,sort_order,created_at';
function submission(row:any):CommunitySubmission{return {id:row.id,title:row.title,credit:row.credit,status:row.status,width:row.width,height:row.height,featured:row.featured,sortOrder:row.sort_order,createdAt:row.created_at.toISOString(),imageUrl:`/game/api/community/submissions/${row.id}/image`};}
export class CommunityRepository {
 constructor(readonly economy:EconomyRepository){}
 async initialise(){await this.economy.transaction(async c=>{await c.query('SELECT pg_advisory_xact_lock(782641092)');const versions=(await c.query('SELECT version FROM guest_schema_migrations')).rows.map(r=>r.version);if(!versions.includes(6)||versions.some(v=>![1,2,3,4,5,6,7,8,9,10,11,12,13].includes(v)))throw new Error('Unsupported community schema');if(!versions.includes(8)){await c.query(await readFile(new URL('./migrations/008_community.sql',import.meta.url),'utf8'));await c.query('INSERT INTO guest_schema_migrations(version) VALUES(8)');}});}
 async initialiseProtection(){await this.economy.transaction(async c=>{
  await c.query("SET LOCAL lock_timeout='5s'");await c.query('SELECT pg_advisory_xact_lock(782641092)');
  const versions=(await c.query('SELECT version FROM guest_schema_migrations')).rows.map(r=>r.version);
  if(!versions.includes(11)||versions.some(v=>!Number.isInteger(v)||v<1||v>13))throw new Error('Unsupported submission protection schema');
  if(!versions.includes(12)){await c.query(await readFile(new URL('./migrations/012_submission_protection.sql',import.meta.url),'utf8'));await c.query('INSERT INTO guest_schema_migrations(version) VALUES(12)');}
  await c.query('UPDATE community_programme SET submission_protection=$1::jsonb WHERE submission_protection IS NULL',[JSON.stringify(createSubmissionProtectionState())]);
 });}
 private async protection(c:PoolClient){
  const row=(await c.query('SELECT *,clock_timestamp() AS protection_now FROM community_programme WHERE singleton')).rows[0];
  const pending=(await c.query("SELECT count(*)::int AS count FROM community_images WHERE status='pending'")).rows[0].count;
  return {state:row.submission_protection as SubmissionProtectionState|undefined,pending,now:row.protection_now.getTime() as number};
 }
 private async saveProtection(c:PoolClient,state:SubmissionProtectionState){await c.query('UPDATE community_programme SET submission_protection=$1::jsonb WHERE singleton',[JSON.stringify(state)]);}
 private async refreshProtection(c:PoolClient){const data=await this.protection(c);if(data.state){const updated=inspectSubmissionProtection(data.state,data.pending,data.now);await this.saveProtection(c,updated.state);}}
 async protectionStatus():Promise<SubmissionProtectionSnapshot>{return this.economy.transaction(async c=>{await this.lock(c);const data=await this.protection(c);if(!data.state)throw new Error('Submission protection not initialised');const updated=inspectSubmissionProtection(data.state,data.pending,data.now);await this.saveProtection(c,updated.state);return updated.snapshot;});}
 async changeProtection(input:{action:'pause'|'resume'|'clear-cooldown';profileId?:string}):Promise<SubmissionProtectionSnapshot>{return this.economy.transaction(async c=>{await this.lock(c);const data=await this.protection(c);if(!data.state)throw new Error('Submission protection not initialised');if(input.action==='clear-cooldown'&&!input.profileId)throw new CommunityError('Profile required');const updated=input.action==='clear-cooldown'?clearSubmissionAccountCooldown(data.state,input.profileId!,data.pending,data.now):setSubmissionManualPause(data.state,input.action==='pause',data.pending,data.now);await this.saveProtection(c,updated.state);return updated.snapshot;});}
 private async receipt(c:PoolClient,ownerKey:string,requestId:string,payloadHash:string):Promise<ProtectedSubmissionResult|null>{
  const row=(await c.query("SELECT payload_hash,status,body FROM community_upload_receipts WHERE owner_key=$1 AND request_id=$2 AND created_at>clock_timestamp()-interval '30 days'",[ownerKey,requestId])).rows[0];
  if(!row)return null;if(row.payload_hash!==payloadHash)throw new CommunityError('Upload request ID was already used for different content.',409);return {status:row.status,body:row.body};
 }
 async replay(ownerKey:string,requestId:string,payloadHash:string):Promise<ProtectedSubmissionResult|null>{return this.economy.transaction(c=>this.receipt(c,ownerKey,requestId,payloadHash));}
 async submitProtected(input:ProtectedSubmissionInput):Promise<ProtectedSubmissionResult>{return this.economy.transaction(async c=>{
  await this.lock(c);const ownerKey=input.owner??'admin';
  const replay=await this.receipt(c,ownerKey,input.requestId,input.payloadHash);if(replay)return replay;
  await c.query("DELETE FROM community_upload_receipts WHERE created_at<=clock_timestamp()-interval '30 days'");
  const data=await this.protection(c);if(!data.state)throw new Error('Submission protection not initialised');
  const actor={profileId:ownerKey,network:input.network,requestId:input.requestId,pending:data.pending,admin:input.admin,now:data.now};
  const maintenance=inspectSubmissionProtection(data.state,data.pending,data.now);
  const admitted=admitSubmission(maintenance.state,actor);let state=admitted.state;
  const finish=async(status:number,body:ProtectedSubmissionResult['body'])=>{
   if(status===429){await this.saveProtection(c,maintenance.state);return {status,body};}
   await this.saveProtection(c,state);await c.query('INSERT INTO community_upload_receipts(owner_key,request_id,payload_hash,status,body) VALUES($1,$2,$3,$4,$5::jsonb)',[ownerKey,input.requestId,input.payloadHash,status,JSON.stringify(body)]);return {status,body};
  };
  if(!admitted.decision.allowed)return finish(429,{error:`Submissions unavailable (${admitted.decision.reason}). Please try later.`});
  if(admitted.decision.replay)return finish(409,{error:'Upload request has already been processed.'});
  const counts=(await c.query("SELECT count(*)::int AS retained,count(*) FILTER(WHERE status='pending')::int AS pending,count(*) FILTER(WHERE status='pending' AND owner_id IS NOT DISTINCT FROM $1::uuid)::int AS owned FROM community_images",[input.owner])).rows[0];
  if(counts.retained>=LIMITS.retained||counts.pending>=LIMITS.pendingGlobal||counts.owned>=LIMITS.pendingPerGuest)return finish(429,{error:'The submission queue is full. Please try later.'});
  await c.query("DELETE FROM community_submission_days WHERE day < (now() AT TIME ZONE 'UTC')::date - 1");
  const quotas=[['global',LIMITS.dailyGlobal],[ownerKey,LIMITS.dailyPerGuest]] as const;
  for(const [key,limit] of quotas){const current=(await c.query("SELECT count FROM community_submission_days WHERE day=(now() AT TIME ZONE 'UTC')::date AND owner_key=$1",[key])).rows[0]?.count??0;if(current>=limit)return finish(429,{error:'Daily submission limit reached.'});}
  if(input.invalid){state=recordInvalidSubmission(state,actor).state;return finish(input.invalidStatus??400,{error:input.invalid});}
  if(!input.image)throw new Error('Normalised image required');
  const digest=createHash('sha256').update(input.image.data).digest('hex');
  if((await c.query("SELECT 1 FROM community_images WHERE COALESCE(owner_id::text,'admin')=$1 AND image_digest=$2 LIMIT 1",[ownerKey,digest])).rowCount){state=recordInvalidSubmission(state,actor).state;return finish(409,{error:'You have already submitted this image.'});}
  for(const [key] of quotas)await c.query("INSERT INTO community_submission_days(day,owner_key,count) VALUES((now() AT TIME ZONE 'UTC')::date,$1,1) ON CONFLICT(day,owner_key) DO UPDATE SET count=community_submission_days.count+1",[key]);
  const row=(await c.query(`INSERT INTO community_images(id,owner_id,title,credit,image,width,height,image_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${columns}`,[randomUUID(),input.owner,input.title,input.credit,input.image.data,input.image.width,input.image.height,digest])).rows[0];
  state=inspectSubmissionProtection(state,counts.pending+1,data.now).state;
  return finish(201,submission(row));
 });}
 private async lock(c:PoolClient){await c.query('SELECT singleton FROM community_programme WHERE singleton FOR UPDATE');}
 private async bump(c:PoolClient){await c.query('UPDATE community_programme SET revision=revision+1,epoch=clock_timestamp() WHERE singleton');}
 async programme():Promise<Programme>{return this.economy.transaction(async c=>{await this.lock(c);return this.snapshot(c);});}
 private async snapshot(c:PoolClient):Promise<Programme>{const row=(await c.query('SELECT *,clock_timestamp() AS server_now FROM community_programme WHERE singleton')).rows[0];const images=(await c.query(`SELECT ${columns} FROM community_images WHERE status='approved' ORDER BY featured DESC,sort_order,created_at,id`)).rows.map(r=>{const {status,createdAt,...image}=submission(r);return {...image,imageUrl:`/game/api/community/images/${r.id}`};});return {revision:row.revision,epochMs:row.epoch.getTime(),serverNowMs:row.server_now.getTime(),mode:row.mode,platform:row.platform,twitchChannel:BRIDGEMIND_TWITCH_CHANNEL,youtubeVideoId:row.youtube_video_id,schedule:row.schedule,images:communityImages(images)};}
 async list(owner?:string):Promise<CommunitySubmission[]>{return (await this.economy.pool.query(`SELECT ${columns} FROM community_images ${owner?'WHERE owner_id=$1':''} ORDER BY created_at DESC,id LIMIT 200`,owner?[owner]:[])).rows.map(submission);}
 async image(id:string,access:{public?:boolean;owner?:string;admin?:boolean}):Promise<Buffer|undefined>{return (await this.economy.pool.query(`SELECT image FROM community_images WHERE id=$1 AND ${access.public?"status='approved'":access.admin?'true':'owner_id=$2'}`,access.public||access.admin?[id]:[id,access.owner??null])).rows[0]?.image;}
 async submit(owner:string|null,title:string,credit:string,image:Buffer,width:number,height:number):Promise<CommunitySubmission>{return this.economy.transaction(async c=>{
  await this.lock(c);
  const counts=(await c.query("SELECT count(*)::int AS retained,count(*) FILTER(WHERE status='pending')::int AS pending,count(*) FILTER(WHERE status='pending' AND owner_id IS NOT DISTINCT FROM $1::uuid)::int AS owned FROM community_images",[owner])).rows[0];
  if(counts.retained>=LIMITS.retained||counts.pending>=LIMITS.pendingGlobal||counts.owned>=LIMITS.pendingPerGuest)throw new CommunityError('The submission queue is full. Please try later.',429);
  await c.query("DELETE FROM community_submission_days WHERE day < (now() AT TIME ZONE 'UTC')::date - 1");
  for(const [key,limit] of [['global',LIMITS.dailyGlobal],[owner??'admin',LIMITS.dailyPerGuest]] as const){const result=await c.query("INSERT INTO community_submission_days(day,owner_key,count) VALUES((now() AT TIME ZONE 'UTC')::date,$1,1) ON CONFLICT(day,owner_key) DO UPDATE SET count=community_submission_days.count+1 WHERE community_submission_days.count<$2 RETURNING count",[key,limit]);if(!result.rowCount)throw new CommunityError('Daily submission limit reached.',429);}
  return submission((await c.query(`INSERT INTO community_images(id,owner_id,title,credit,image,width,height) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING ${columns}`,[randomUUID(),owner,title,credit,image,width,height])).rows[0]);
 });}
 async moderate(id:string,patch:{status?:'approved'|'rejected';featured?:boolean;sortOrder?:number}){return this.economy.transaction(async c=>{await this.lock(c);const row=(await c.query(`UPDATE community_images SET status=COALESCE($2,status),featured=COALESCE($3,featured),sort_order=COALESCE($4,sort_order),moderated_at=now() WHERE id=$1 RETURNING ${columns}`,[id,patch.status??null,patch.featured??null,patch.sortOrder??null])).rows[0];if(!row)throw new CommunityError('Image unavailable',404);await c.query('INSERT INTO community_moderation(image_id,action) VALUES($1,$2)',[id,JSON.stringify(patch)]);await this.bump(c);await this.refreshProtection(c);return submission(row);});}
 async remove(id:string){await this.economy.transaction(async c=>{await this.lock(c);if(!(await c.query('DELETE FROM community_images WHERE id=$1',[id])).rowCount)throw new CommunityError('Image unavailable',404);await c.query("INSERT INTO community_moderation(image_id,action) VALUES($1,'deleted')",[id]);await this.bump(c);await this.refreshProtection(c);});}
 async update(settings:ProgrammeSettings,expectedRevision:number){return this.economy.transaction(async c=>{await this.lock(c);const result=await c.query('UPDATE community_programme SET mode=$1,platform=$2,twitch_channel=$3,youtube_video_id=$4,schedule=$5::jsonb,revision=revision+1,epoch=clock_timestamp() WHERE singleton AND revision=$6 RETURNING revision',[settings.mode,settings.platform,settings.twitchChannel,settings.youtubeVideoId,JSON.stringify(settings.schedule),expectedRevision]);if(!result.rowCount)throw new CommunityError('Programme changed. Refresh before saving.',409);return this.snapshot(c);});}
}
