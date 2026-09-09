import { randomUUID } from 'node:crypto';
import { SALARY_INTERVAL_MS, type WalletState } from '../shared/catalog.ts';
import type { EconomyRepository } from './persistence/economy.ts';
type SalaryRepository = Pick<EconomyRepository,'openSession'|'checkpoint'>;
type Options = { now?:()=>number; autoTick?:boolean; onSnapshot:(profileId:string,sessionId:string,state:WalletState,accruing:boolean)=>void; onError?:(profileId:string,sessionId:string)=>void };
type Session = { profileId:string; sessionId:string; roomId:string; epoch:string; cumulative:number; committed:number; last:number; lease:number; lastFlush:number; stopped:boolean; pending:Promise<void>; writing:boolean; requested:number; snapshot:WalletState };
export class SalaryTracker {
 private sessions=new Map<string,Session>();
 private timer?:ReturnType<typeof setInterval>;
 private now:()=>number;
 constructor(private repository:SalaryRepository,private options:Options){
  this.now=options.now??(()=>performance.now());
  if(options.autoTick!==false){this.timer=setInterval(()=>this.tick(),1000);this.timer.unref();}
 }
 async start(profileId:string,sessionId:string,roomId:string){
  if(this.sessions.has(sessionId))throw new Error('Salary session already started');
  const epoch=randomUUID(),snapshot=await this.repository.openSession(profileId,epoch),now=this.now();
  this.sessions.set(sessionId,{profileId,sessionId,roomId,epoch,cumulative:0,committed:0,last:now,lease:0,lastFlush:now,stopped:false,pending:Promise.resolve(),writing:false,requested:0,snapshot});
  return snapshot;
 }
 private advance(s:Session){const now=this.now();if(!s.stopped && now-s.last<=10000)s.cumulative+=Math.max(0,Math.floor(Math.min(now,s.lease)-s.last));s.last=now;}
 private emit(s:Session){this.options.onSnapshot(s.profileId,s.sessionId,s.snapshot,!s.stopped&&this.now()<s.lease);}
 private flush(s:Session):Promise<void>{
  s.requested=s.cumulative;s.lastFlush=this.now();
  if(s.writing)return s.pending;
  s.writing=true;
  s.pending=(async()=>{
   do {
    const cumulative=s.requested;
    s.snapshot=await this.repository.checkpoint(s.profileId,s.epoch,cumulative);s.committed=cumulative;
    if(!s.stopped)this.emit(s);
    if(cumulative===s.requested)break;
   } while(true);
  })().finally(()=>{s.writing=false;});
  return s.pending;
 }
 heartbeat(sessionId:string,visible:boolean){
  const s=this.sessions.get(sessionId);if(!s||s.stopped)return;
  this.advance(s);s.lease=visible?this.now()+10000:0;
  this.emit(s);
  if(!visible)void this.flush(s).catch(()=>this.options.onError?.(s.profileId,s.sessionId));
 }
 tick(){for(const s of this.sessions.values()){
  if(s.stopped)continue;const wasAccruing=s.last<s.lease;this.advance(s);
  if(this.now()-s.lastFlush>=5000 || s.snapshot.salaryProgressMs+s.cumulative-s.committed>=SALARY_INTERVAL_MS)void this.flush(s).catch(()=>this.options.onError?.(s.profileId,s.sessionId));
  else if(wasAccruing&&this.now()>=s.lease)this.emit(s);
 }}
 async stop(sessionId:string){
  const s=this.sessions.get(sessionId);if(!s)return;
  if(s.stopped){await s.pending;return;}
  this.advance(s);s.stopped=true;s.lease=0;this.emit(s);
  try{await this.flush(s);}finally{if(this.sessions.get(sessionId)===s)this.sessions.delete(sessionId);}
 }
 async dispose(){if(this.timer)clearInterval(this.timer);await Promise.allSettled([...this.sessions.keys()].map(id=>this.stop(id)));}
}
