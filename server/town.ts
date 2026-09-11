import { Room, ServerError, type AuthContext, type Client } from '@colyseus/core';
import { Citizen, TownState } from '../shared/state.ts';
import { CAPACITY, TICK_MS, move, parseInput, isWalkable, canHopAt, type Input } from '../shared/world.ts';

import { guests, sessions, towns, voice, salary, casinoRepository, safety } from './context.ts';
import { clientAddress, socketIdentities } from './clientAddress.ts';
import { SAFETY_LIMITS, SafetyError, TokenBucket } from './safety.ts';
import { CasinoService } from './casino/service.ts';
import { CASINO_ANCHORS, BLACKJACK_SEAT_OFFSETS, type CasinoState, type CasinoTableId } from '../shared/casino.ts';
import { POKER_SEAT_OFFSETS } from '../shared/pokerLayout.ts';
import { randomUUID } from 'node:crypto';
import { isInShop, type WalletState } from '../shared/catalog.ts';
import { authenticateGuest, isAllowedOrigin } from './guest.ts';
import type { PrivateGuestProfile } from '../shared/profile.ts';
import { requestSit, requestStand } from './seating.ts';
import { voiceGain, type VoiceNeighbour } from '../shared/voice.ts';
import { checkChat, MODERATION_NOTICES, sanitizeChatBody } from '../shared/moderation.ts';
import { ChatDiscipline } from './moderation.ts';
import { SharedEmotes } from './emotes.ts';
import { HOP_COOLDOWN_MS, isHopping } from '../shared/mobility.ts';

export class TownRoom extends Room<{ state: TownState }> {
  maxClients = CAPACITY;
  maxMessagesPerSecond = SAFETY_LIMITS.messagesPerSecond;
  private controlMessages = new TokenBucket(20,1000,128);
  private stoppedSessions = new Set<string>();
  private frameObservers = new Map<string, () => void>();
  state = new TownState();
  private movementInputs = new Map<string, { input: Input; at: number }>();
  private interactionBusy = new Set<string>();
  private emotes = new SharedEmotes({
    players: () => this.state.players.entries(),
    blocked: (a, b) => !!this.isBlocked(a, b),
    busy: id => this.interactionBusy.has(id),
    inbox: (id, value) => this.clients.find(client => client.sessionId === id)?.send('emote-inbox', value),
    notice: (id, value) => this.clients.find(client => client.sessionId === id)?.send('notice', value),
    stopInput: id => this.movementInputs.delete(id),
  });
  socialPresence(profileId: string) {
    for (const [sessionId, player] of this.state.players) if (player.profileId === profileId&&!this.stoppedSessions.has(sessionId)) return { sessionId, x: player.x, z: player.z };
    return undefined;
  }
  socialChanged(profileIds: string[]) {
    for (const client of this.clients) if (profileIds.includes(this.state.players.get(client.sessionId)?.profileId ?? '')) client.send('social-changed', {});
  }
  private chatAt = new Map<string, number>();
  private waveAt = new Map<string, number>();
  private discipline = new ChatDiscipline();

  private blocked = new Map<string, Set<string>>();
  private hearing = new Map<string, Map<string, number>>();
  private hearingJson = new Map<string, string>();
  private blockRefreshes = new Map<string, Promise<void>>();
  private wallets = new Map<string, WalletState>();
  private accruing = new Map<string, boolean>();
  private casino!: CasinoService;
  private casinoCommandAt = new Map<string, number[]>();
  private casinoSeats(state: CasinoState) {
    for (const citizen of this.state.players.values()) {
      let seat: { id: string; x: number; z: number; heading: number } | undefined;
      for (const table of state.tables) {
        const anchor=CASINO_ANCHORS.find(anchor=>anchor.id===table.id)!;
        if(table.game==='blackjack') {
          const occupied=table.seats.find(seat=>seat.player.profileId===citizen.profileId && seat.player.connected);
          if(occupied) {const offset=BLACKJACK_SEAT_OFFSETS[occupied.seat];if(offset)seat={id:`casino:${table.id}:${occupied.seat}`,x:anchor.x+offset.x,z:anchor.z+offset.z,heading:offset.heading};}
        } else if(table.game==='poker') {
          // Reconnects return to their reserved chair; departing players can walk away while chips settle.
          const occupied=table.seats.find(seat=>seat.player.profileId===citizen.profileId && !seat.leaving);
          if(occupied) {const offset=POKER_SEAT_OFFSETS[occupied.seat];if(offset)seat={id:`casino:${table.id}:${occupied.seat}`,x:anchor.x+offset.x,z:anchor.z+offset.z,heading:offset.heading};}
        } else if(table.game==='slots' && table.player?.profileId===citizen.profileId && table.player.connected) seat={id:`casino:${table.id}:0`,x:anchor.x,z:anchor.z-1.25,heading:0};
      }
      if(seat) {for(const [id,p] of this.state.players)if(p===citizen)this.emotes.cancelFor(id);citizen.jumpAt=0;citizen.sprinting=false;citizen.seatId=seat.id;citizen.x=seat.x;citizen.z=seat.z;citizen.heading=seat.heading;citizen.moving=false;}
      else if(citizen.seatId.startsWith('casino:')) {
        const previous=citizen.seatId;citizen.seatId='';
        if(previous.startsWith('casino:poker-1:')) {
          const anchor=CASINO_ANCHORS.find(a=>a.id==='poker-1')!, offset=POKER_SEAT_OFFSETS[Number(previous.split(':')[2])];
          if(offset && isWalkable(anchor.x+offset.exitX,anchor.z+offset.exitZ)){citizen.x=anchor.x+offset.exitX;citizen.z=anchor.z+offset.exitZ;}
        } else {const z=citizen.z-.85;if(isWalkable(citizen.x,z))citizen.z=z;}
      }
    }
  }
  canPurchase(profileId:string) { const active=sessions.get(profileId); const player=active && this.state.players.get(active.sessionId); return !!player && player.profileId===profileId && !this.stoppedSessions.has(active!.sessionId) && isInShop(player.x,player.z); }
  publishEconomy(profileId:string,sessionId:string,state:WalletState,accruing?:boolean) {
    const player=this.state.players.get(sessionId),client=this.clients.find(client=>client.sessionId===sessionId);
    if (!player || !client || player.profileId!==profileId || sessions.get(profileId)?.sessionId!==sessionId) return;
    const previous=this.wallets.get(sessionId);
    if(!previous || state.revision>=previous.revision)this.wallets.set(sessionId,state);
    if(accruing!==undefined)this.accruing.set(sessionId,accruing);
    const current=this.wallets.get(sessionId)!;
    Object.assign(player,current.outfit);
    client.send('economy',{...current,accruing:this.accruing.get(sessionId)??false});
  }
  economyError(sessionId:string) { this.clients.find(client=>client.sessionId===sessionId)?.send('economy-error','Salary saving is delayed. Your last saved balance is safe.'); }
  hasSession(id: string) { return this.state.players.has(id)&&!this.stoppedSessions.has(id); }
  refreshBlocks(id: string): Promise<void> {
    const refresh = (this.blockRefreshes.get(id) ?? Promise.resolve()).catch(() => {}).then(async () => {
      if (![...this.state.players.values()].some(player => player.profileId === id)) return;
      const blocks = await guests.blocks(id);
      if (![...this.state.players.values()].some(player => player.profileId === id)) return;
      this.blocked.set(id, new Set(blocks)); this.updateVoice();
    });
    this.blockRefreshes.set(id, refresh);
    void refresh.finally(() => { if (this.blockRefreshes.get(id) === refresh) this.blockRefreshes.delete(id); }).catch(() => {});
    return refresh;
  }
  private isBlocked(a: string, b: string) { return this.blocked.get(a)?.has(b) || this.blocked.get(b)?.has(a); }
  private updateVoice() {
    for (const client of this.clients) {
      const listener = this.state.players.get(client.sessionId); if (!listener) continue;
      const previous = this.hearing.get(client.sessionId), current = new Map<string, number>();
      const targets: VoiceNeighbour[] = [];
      for (const [id, speaker] of this.state.players) {
        if (id === client.sessionId || this.isBlocked(listener.profileId, speaker.profileId)) continue;
        const gain = voiceGain(listener, speaker, previous?.has(id));
        if (gain !== null) { const rounded = Math.round(gain * 100) / 100; current.set(id, rounded); targets.push({ sessionId: id, gain: rounded }); }
      }
      this.hearing.set(client.sessionId, current);
      const json = JSON.stringify(targets);
      if (this.hearingJson.get(client.sessionId) !== json) { client.send('voice-neighbours', targets); this.hearingJson.set(client.sessionId, json); }
    }
  }
  onCreate() {
    // Wrap application handlers to stop banned/flooding sessions immediately, including
    // while the WebSocket close handshake is still in progress.
    const register = this.onMessage.bind(this);
    this.onMessage = ((type: string | number, handler: (client: Client, value: unknown) => void) => register(type, (client, value: unknown) => {
      if(this.stoppedSessions.has(client.sessionId))return;
      if(type!=='input' && type!=='chat' && type!=='casino-command' && !this.controlMessages.take(client.sessionId)) { safety.eventFor(client.sessionId,'control_rate_limited'); return; }
      handler(client,value);
    })) as typeof this.onMessage;
    towns.set(this.roomId, this);
    this.casino=new CasinoService(this.roomId,casinoRepository,{
      actor: profileId=>{const active=sessions.get(profileId);const citizen=active?.roomId===this.roomId&&!this.stoppedSessions.has(active.sessionId)?this.state.players.get(active.sessionId):undefined;return citizen?{sessionId:active!.sessionId,name:citizen.name,x:citizen.x,z:citizen.z}:undefined;},
      publish: state=>{this.casinoSeats(state);this.broadcast('casino-state',state);},
      private: (profileId,message,payload)=>{const active=sessions.get(profileId);if(active?.roomId===this.roomId)this.clients.find(client=>client.sessionId===active.sessionId)?.send(message,payload);},
      wallet: (profileId,state)=>{const active=sessions.get(profileId);if(active?.roomId===this.roomId)this.publishEconomy(profileId,active.sessionId,state);},
    });
    this.casino.start();
    this.onMessage('casino-command',(client,command:unknown)=>{
      const citizen=this.state.players.get(client.sessionId);if(!citizen)return;
      const now=Date.now(),recent=(this.casinoCommandAt.get(client.sessionId)??[]).filter(at=>now-at<1000);
      if(recent.length>=8){safety.eventFor(client.sessionId,'casino_rate_limited');client.send('casino-receipt',{requestId:typeof (command as {requestId?:unknown})?.requestId==='string'?(command as {requestId:string}).requestId:'',ok:false,code:'rate_limit',message:'Please wait a moment before another table action.'});return;}
      recent.push(now);this.casinoCommandAt.set(client.sessionId,recent);
      void this.casino.handle(citizen.profileId,command).catch(()=>client.send('notice','The casino could not save that action. Please retry shortly.'));
    });
    this.clock.setInterval(() => this.updateVoice(), 250);
    this.onMessage('presence',(client,visible:unknown)=>{if(typeof visible==='boolean')salary.heartbeat(client.sessionId,visible);});
    this.onMessage('economy-sync',client=>{const player=this.state.players.get(client.sessionId),wallet=this.wallets.get(client.sessionId);if(player&&wallet)this.publishEconomy(player.profileId,client.sessionId,wallet);});
    this.onMessage('emote-command', (client, command: unknown) => this.emotes.handle(client.sessionId, command));
    this.onMessage('interaction-busy', (client, busy: unknown) => {
      if (typeof busy !== 'boolean') return;
      if (busy) { this.interactionBusy.add(client.sessionId); this.emotes.cancelFor(client.sessionId); this.movementInputs.delete(client.sessionId); }
      else this.interactionBusy.delete(client.sessionId);
    });
    this.onMessage('jump', client => {
      const player = this.state.players.get(client.sessionId), now = Date.now();
      if (!player || player.seatId || player.emoteId || this.interactionBusy.has(client.sessionId) || now - player.jumpAt < HOP_COOLDOWN_MS) return;
      if (!canHopAt(player.x, player.z)) { client.send('notice', 'Move into a clear space to jump.'); return; }
      this.emotes.cancelFor(client.sessionId); player.jumpAt = now;
    });
    this.onMessage('sit', (client, id: unknown) => {
      const citizen = this.state.players.get(client.sessionId); if (!citizen) return;
      if (isHopping(citizen.jumpAt, Date.now())) { client.send('notice', 'Land before taking a seat.'); return; }
      const next = requestSit(citizen, id, this.state.players.values());
      if (!next) { client.send('notice', 'That seat is occupied or too far away.'); return; }
      this.emotes.cancelFor(client.sessionId); Object.assign(citizen, next); citizen.sprinting = false; citizen.moving = false; this.movementInputs.delete(client.sessionId);
    });
    this.onMessage('stand', client => {
      const citizen = this.state.players.get(client.sessionId); if (!citizen) return;
      if(citizen.seatId.startsWith('casino:')) {void this.casino.handle(citizen.profileId,{requestId:randomUUID(),action:'leave',tableId:citizen.seatId.split(':')[1] as CasinoTableId});return;}
      const next = requestStand(citizen); if (next) { Object.assign(citizen, next); citizen.moving = false; this.movementInputs.delete(client.sessionId); }
    });
    this.patchRate = TICK_MS;
    this.onMessage('input', (client, value: unknown) => {
      const input = parseInput(value), previous = this.movementInputs.get(client.sessionId);
      const player = this.state.players.get(client.sessionId);
      if (input && input.seq > Math.max(previous?.input.seq ?? -1, player?.ack ?? -1)) {
        if (player?.emoteId && Math.hypot(input.x, input.z) > .01) this.emotes.cancelFor(client.sessionId);
        this.movementInputs.set(client.sessionId, { input, at: performance.now() });
      }
    });
    this.onMessage('chat', (client, value: unknown) => {
      if (typeof value !== 'string') return;
      const now = performance.now();
      if (now - (this.chatAt.get(client.sessionId) ?? -10000) < 800) { safety.eventFor(client.sessionId,'chat_rate_limited'); return; }
      const citizen = this.state.players.get(client.sessionId);
      if (!citizen) return;
      const silenced = this.discipline.silenceRemaining(citizen.profileId);
      if (silenced > 0) { this.chatAt.set(client.sessionId, now); client.send('silenced', { seconds: Math.ceil(silenced / 1000) }); return; }
      const body = sanitizeChatBody(value);
      if (!body) return;
      this.chatAt.set(client.sessionId, now);
      const verdict = checkChat(body);
      if (!verdict.ok) {
        const { silencedMs } = this.discipline.recordOffence(citizen.profileId);
        client.send('notice', verdict.reason === 'url' ? MODERATION_NOTICES.url : MODERATION_NOTICES.profanity);
        if (silencedMs > 0) client.send('silenced', { seconds: Math.ceil(silencedMs / 1000) });
        return;
      }
      if (this.discipline.isRepeat(client.sessionId, body)) { client.send('notice', MODERATION_NOTICES.repeat); return; }
      if (this.discipline.flooding(client.sessionId)) {
        const { silencedMs } = this.discipline.recordOffence(citizen.profileId);
        client.send('notice', MODERATION_NOTICES.flood);
        if (silencedMs > 0) client.send('silenced', { seconds: Math.ceil(silencedMs / 1000) });
        return;
      }
      for (const receiver of this.clients) {
        const target = this.state.players.get(receiver.sessionId);
        if (target && !this.isBlocked(citizen.profileId, target.profileId)) receiver.send('chat', { id: client.sessionId, profileId: citizen.profileId, name: citizen.name, body });
      }
    });
    this.onMessage('wave', client => {
      const now = performance.now();
      if (now - (this.waveAt.get(client.sessionId) ?? -10000) < 2000) return;
      const citizen = this.state.players.get(client.sessionId);
      if (citizen && !citizen.seatId && !citizen.emoteId && !isHopping(citizen.jumpAt, Date.now()) && !this.interactionBusy.has(client.sessionId)) { citizen.wave = Date.now(); this.waveAt.set(client.sessionId, now); }
    });
    this.setSimulationInterval(() => this.tick(), TICK_MS);
  }
  static async onAuth(_token: string, _options: unknown, context: AuthContext) {
    if (!isAllowedOrigin(context.headers.get('origin') ?? undefined)) throw new ServerError(403, 'Open the game from its configured address.');
    const ip=clientAddress(context.headers);
    if(!ip)throw new SafetyError(503,'untrusted_proxy','Game gateway unavailable.');
    safety.checkBan(ip);
    const profile = await authenticateGuest(context.headers.get('cookie') ?? undefined, guests);
    if (!profile) throw new ServerError(401, 'Your guest profile could not be restored.');
    safety.checkProfile(ip,profile);
    safety.limitGuestJoin(ip,profile.id);
    return { profile };
  }
  async onJoin(client: Client) {
    const auth = client.auth as { profile: PrivateGuestProfile };
    if (!sessions.claim(auth.profile.id, client.sessionId, this.roomId)) throw new ServerError(409, 'This guest is already in town in another tab.');
    let salaryStarted=false;
    try {
      const identity=socketIdentities.get(client.ref);
      if(!identity)throw new SafetyError(503,'untrusted_proxy','Game gateway unavailable.');
      safety.connect({sessionId:client.sessionId,profileId:auth.profile.id,name:auth.profile.name,ip:identity.ip},()=>this.stopClient(client,4003,'Access to Slop City is currently restricted.'));
      const profile = await authenticateGuest(identity.cookie, guests);
      if (!profile || profile.id!==auth.profile.id) throw new ServerError(401, 'Your guest profile has expired.');
      safety.checkProfile(identity.ip,profile);
      client.auth = { profile }; // Do not retain the credential after admission.
      delete identity.cookie;
      const wallet = await salary.start(profile.id,client.sessionId,this.roomId);
      salaryStarted=true;
      safety.checkProfile(identity.ip,profile);
      if(this.stoppedSessions.has(client.sessionId)||!identity.isOpen())throw new SafetyError(403,'disconnected','Connection ended.');
      const citizen = new Citizen();
      Object.assign(citizen, { profileId: profile.id, name: profile.name, shirt: profile.shirt, skin: profile.skin });
      citizen.x = (this.state.players.size % 8 - 3.5) * .9;
      citizen.z = -17 - Math.floor(this.state.players.size / 8) * .8;
      this.blocked.set(profile.id, new Set(profile.blocks));
      this.state.players.set(client.sessionId, citizen);
      this.wallets.set(client.sessionId,wallet); Object.assign(citizen,wallet.outfit);
      // Observe raw frames without decoding payloads. The framework remains the
      // hard frame limiter; this records floods and stops app work immediately.
      let at=Date.now(),count=0;
      const observe=()=>{const now=Date.now();if(now-at>=1000){at=now;count=0;}safety.count('game_messages');if(++count>SAFETY_LIMITS.messagesPerSecond&&!this.stoppedSessions.has(client.sessionId)){safety.eventFor(client.sessionId,'message_flood_disconnected');this.stopClient(client,4008,'Too many game messages. Please wait before rejoining.');}};
      client.ref.prependListener('message',observe);this.frameObservers.set(client.sessionId,observe);
      safety.joined(client.sessionId);
    } catch (error) { if(salaryStarted)await salary.stop(client.sessionId).catch(()=>{});safety.disconnect(client.sessionId);this.stoppedSessions.delete(client.sessionId);sessions.release(auth.profile.id, client.sessionId, this.roomId);throw error; }
  }
  private stopClient(client:Client,code:number,message:string) {
    this.stoppedSessions.add(client.sessionId);this.movementInputs.delete(client.sessionId);
    salary.heartbeat(client.sessionId,false);
    void voice.remove(this.roomId,client.sessionId);
    client.leave(code,message);
    // A modified client may never acknowledge close. Bound retention of its seat.
    const identity=socketIdentities.get(client.ref);
    const timer=setTimeout(()=>identity?.terminate(),1000);timer.unref();
  }
  async onLeave(client: Client) {
    socketIdentities.delete(client.ref);
    const observer=this.frameObservers.get(client.sessionId);if(observer)client.ref.removeListener('message',observer);this.frameObservers.delete(client.sessionId);
    safety.disconnect(client.sessionId);this.stoppedSessions.delete(client.sessionId);
    const profile = client.auth?.profile as PrivateGuestProfile | undefined;
    const ownsSession = profile && sessions.get(profile.id)?.sessionId===client.sessionId;
    this.emotes.leave(client.sessionId); this.interactionBusy.delete(client.sessionId);
    if(ownsSession)this.casino.leave(profile.id);
    this.casinoCommandAt.delete(client.sessionId);
    // Freeze accrual immediately; retain admission ownership until its final write settles.
    const stopping = ownsSession ? salary.stop(client.sessionId) : Promise.resolve();
    if(ownsSession)this.blocked.delete(profile.id);
    this.discipline.dispose(client.sessionId);
    for (const map of [this.movementInputs, this.chatAt, this.waveAt, this.hearing, this.hearingJson]) map.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.wallets.delete(client.sessionId); this.accruing.delete(client.sessionId);
    void voice.remove(this.roomId, client.sessionId);
    this.updateVoice();
    try { await stopping; } catch { /* The last committed checkpoint is retained. */ }
    finally { if(profile)sessions.release(profile.id,client.sessionId,this.roomId); }
  }
  async onDispose() { towns.delete(this.roomId); await this.casino.dispose(); }
  private tick() {
    const now = performance.now();
    this.emotes.tick();
    for (const [id, citizen] of this.state.players) {
      if (citizen.seatId || citizen.emoteId || this.interactionBusy.has(id)) { citizen.moving = false; citizen.sprinting = false; continue; }
      const request = this.movementInputs.get(id);
      const input = request && now - request.at < 250 ? request.input : { x: 0, z: 0, seq: -1 };
      const next = move(citizen, input, TICK_MS / 1000, isHopping(citizen.jumpAt, Date.now()));
      citizen.moving = Math.hypot(next.x - citizen.x, next.z - citizen.z) > .001;
      citizen.sprinting = citizen.moving && !!input.sprint;
      if (citizen.moving) citizen.heading = Math.atan2(input.x, input.z);
      citizen.x = next.x; citizen.z = next.z;
      if (request) citizen.ack = request.input.seq;
    }
  }
}
